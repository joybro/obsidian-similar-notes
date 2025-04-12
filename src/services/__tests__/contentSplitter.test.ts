import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentSplitter } from "../contentSplitter";
import type { EmbeddingModelService } from "../model/embeddingModelService";

describe("ContentSplitter", () => {
    let mockModelService: EmbeddingModelService;
    let contentSplitter: ContentSplitter;

    beforeEach(() => {
        mockModelService = {
            getMaxTokens: vi.fn().mockReturnValue(1000),
            loadModel: vi.fn(),
            unloadModel: vi.fn(),
            embedTexts: vi.fn(),
            countTokens: vi
                .fn()
                .mockImplementation(async (text: string) => text.length),
            dispose: vi.fn(),
        } as unknown as EmbeddingModelService;
        contentSplitter = new ContentSplitter(mockModelService);
    });

    describe("split", () => {
        it("should return empty array for empty content", async () => {
            const result = await contentSplitter.split("");
            expect(result).toEqual([]);
        });

        it("should return single chunk for content shorter than maxTokens", async () => {
            const shortContent = "This is a short content.";
            const result = await contentSplitter.split(shortContent);
            expect(result).toEqual([shortContent]);
        });

        it("should split content into multiple chunks when exceeding maxTokens", async () => {
            const maxTokens = 40;
            const longContent =
                "First sentence. Second sentence. Third sentence. Fourth sentence.";
            vi.mocked(mockModelService.getMaxTokens).mockReturnValue(maxTokens);
            contentSplitter = new ContentSplitter(mockModelService);

            const result = await contentSplitter.split(longContent);
            expect(result.length).toBeGreaterThan(1);
            for (const chunk of result) {
                const tokenCount = await mockModelService.countTokens(chunk);
                expect(tokenCount).toBeLessThanOrEqual(maxTokens);
            }
        });

        it("should handle content without trailing spaces after sentences", async () => {
            const maxTokens = 20;
            const content = "First sentence.Second sentence.Third sentence.";
            vi.mocked(mockModelService.getMaxTokens).mockReturnValue(maxTokens);
            contentSplitter = new ContentSplitter(mockModelService);

            const result = await contentSplitter.split(content);
            expect(result.length).toBeGreaterThan(1);
            for (const chunk of result) {
                const tokenCount = await mockModelService.countTokens(chunk);
                expect(tokenCount).toBeLessThanOrEqual(maxTokens);
            }
        });

        it("should minimize the number of countTokens calls with recursive binary splitting", async () => {
            const maxTokens = 40;
            // Reset the mock to count calls
            vi.mocked(mockModelService.countTokens).mockClear();

            const longContent =
                "First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence. Sixth sentence. Seventh sentence. Eighth sentence.";
            vi.mocked(mockModelService.getMaxTokens).mockReturnValue(maxTokens);
            contentSplitter = new ContentSplitter(mockModelService);

            const result = await contentSplitter.split(longContent);

            const tokenCountCalls = vi.mocked(mockModelService.countTokens).mock
                .calls.length;

            expect(result.length).toBeGreaterThan(1);
            // With recursive binary splitting, we should have significantly fewer token count calls
            // than the number of chunks
            expect(tokenCountCalls).toBeLessThan(result.length * 2);

            // Verify all chunks are within token limit
            for (const chunk of result) {
                const tokenCount = await mockModelService.countTokens(chunk);
                expect(tokenCount).toBeLessThanOrEqual(maxTokens);
            }
        });

        it("should handle very long sentences by splitting them", async () => {
            const maxTokens = 15;
            const veryLongSentence =
                "This is a very long sentence that exceeds the token limit by itself and needs to be split into smaller parts.";
            vi.mocked(mockModelService.getMaxTokens).mockReturnValue(maxTokens);
            contentSplitter = new ContentSplitter(mockModelService);

            const result = await contentSplitter.split(veryLongSentence);
            expect(result.length).toBeGreaterThan(1);
            for (const chunk of result) {
                const tokenCount = await mockModelService.countTokens(chunk);
                expect(tokenCount).toBeLessThanOrEqual(maxTokens);
            }
        });

        it("should split markdown content by headers when possible", async () => {
            const maxTokens = 50;
            const markdownContent = `
# Introduction
This is the introduction section with some content.

## First Section
This is the first section with some content.

## Second Section
This is the second section with some content.

### Subsection
This is a subsection with some content.

## Third Section
This is the third section with some content.
            `;
            vi.mocked(mockModelService.getMaxTokens).mockReturnValue(maxTokens);
            contentSplitter = new ContentSplitter(mockModelService);

            const result = await contentSplitter.split(markdownContent);

            // We should have at least 3 chunks (one for each main section)
            expect(result.length).toBeGreaterThanOrEqual(3);

            // Verify all chunks are within token limit
            for (const chunk of result) {
                const tokenCount = await mockModelService.countTokens(chunk);
                expect(tokenCount).toBeLessThanOrEqual(maxTokens);
            }

            // Verify that headers are preserved in the chunks
            const hasIntroHeader = result.some((chunk) =>
                chunk.includes("# Introduction")
            );
            const hasFirstSection = result.some((chunk) =>
                chunk.includes("## First Section")
            );
            const hasSecondSection = result.some((chunk) =>
                chunk.includes("## Second Section")
            );
            const hasThirdSection = result.some((chunk) =>
                chunk.includes("## Third Section")
            );

            expect(hasIntroHeader).toBe(true);
            expect(hasFirstSection).toBe(true);
            expect(hasSecondSection).toBe(true);
            expect(hasThirdSection).toBe(true);
        });

        it("should handle markdown content with nested headers", async () => {
            const maxTokens = 30;
            const markdownContent = `
# Main Title
This is the main content.

## Section 1
This is section 1 content.

### Subsection 1.1
This is subsection 1.1 content.

### Subsection 1.2
This is subsection 1.2 content.

## Section 2
This is section 2 content.

### Subsection 2.1
This is subsection 2.1 content.

### Subsection 2.2
This is subsection 2.2 content.
            `;
            vi.mocked(mockModelService.getMaxTokens).mockReturnValue(maxTokens);
            contentSplitter = new ContentSplitter(mockModelService);

            const result = await contentSplitter.split(markdownContent);

            // We should have multiple chunks due to the token limit
            expect(result.length).toBeGreaterThan(1);

            // Verify all chunks are within token limit
            for (const chunk of result) {
                const tokenCount = await mockModelService.countTokens(chunk);
                expect(tokenCount).toBeLessThanOrEqual(maxTokens);
            }

            // Verify that headers are preserved in the chunks
            const hasMainTitle = result.some((chunk) =>
                chunk.includes("# Main Title")
            );
            const hasSection1 = result.some((chunk) =>
                chunk.includes("## Section 1")
            );
            const hasSection2 = result.some((chunk) =>
                chunk.includes("## Section 2")
            );

            expect(hasMainTitle).toBe(true);
            expect(hasSection1).toBe(true);
            expect(hasSection2).toBe(true);
        });
    });
});
