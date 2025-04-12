import type { EmbeddingModelService } from "./model/embeddingModelService";

export class ContentSplitter {
    private readonly maxTokens: number;

    constructor(private readonly modelService: EmbeddingModelService) {
        this.maxTokens = this.modelService.getMaxTokens();
    }

    async split(content: string): Promise<string[]> {
        if (!content) {
            return [];
        }

        // Check if the entire content is within token limit
        const tokenCount = await this.modelService.countTokens(content);
        if (tokenCount <= this.maxTokens) {
            return [content];
        }

        // Try to split by markdown headers first
        const headerSplitResult = await this.splitByMarkdownHeaders(content);
        if (headerSplitResult.length > 0) {
            return headerSplitResult;
        }

        // If header splitting didn't work, fall back to sentence splitting
        const sentences = content
            .split(/(?<=[.!?])(?:\s+|(?=\S))/)
            .map((s) => s.trim())
            .filter(Boolean);

        // If we have a single sentence that exceeds the token limit, we need to split it further
        if (sentences.length === 1) {
            return this.splitLongSentence(sentences[0]);
        }

        // Use recursive binary splitting
        return this.recursiveBinarySplit(sentences);
    }

    private async splitByMarkdownHeaders(content: string): Promise<string[]> {
        // Regular expression to match markdown headers (# Header, ## Header, etc.)
        const headerRegex = /^(#{1,6})\s+(.+)$/gm;

        // Find all headers in the content
        const headers: { level: number; text: string; index: number }[] = [];
        let match: RegExpExecArray | null;

        // Reset the regex to start from the beginning
        headerRegex.lastIndex = 0;

        // Find all headers in the content
        match = headerRegex.exec(content);
        while (match !== null) {
            const level = match[1].length; // Number of # symbols
            const text = match[2]; // Header text
            const index = match.index; // Position in the content

            headers.push({ level, text, index });

            // Get the next match
            match = headerRegex.exec(content);
        }

        // If no headers found, return empty array to fall back to other splitting methods
        if (headers.length === 0) {
            return [];
        }

        // Sort headers by their position in the content
        headers.sort((a, b) => a.index - b.index);

        // Create chunks based on headers
        const chunks: string[] = [];

        // Process each header
        for (let i = 0; i < headers.length; i++) {
            const currentHeader = headers[i];
            const nextHeader = i < headers.length - 1 ? headers[i + 1] : null;

            // Extract content between current header and next header (or end of content)
            const startIndex = currentHeader.index;
            const endIndex = nextHeader ? nextHeader.index : content.length;
            const chunkContent = content.substring(startIndex, endIndex).trim();

            // Check if this chunk is within token limit
            const tokenCount = await this.modelService.countTokens(
                chunkContent
            );

            if (tokenCount <= this.maxTokens) {
                // If within token limit, add as a single chunk
                chunks.push(chunkContent);
            } else {
                // If exceeds token limit, split further
                // First, try to split by subheaders if they exist
                const subHeaders = headers.filter(
                    (h) =>
                        h.level > currentHeader.level &&
                        h.index > currentHeader.index &&
                        (!nextHeader || h.index < nextHeader.index)
                );

                if (subHeaders.length > 0) {
                    // Split by subheaders
                    const subChunks = await this.splitBySubHeaders(
                        chunkContent,
                        subHeaders
                    );
                    chunks.push(...subChunks);
                } else {
                    // No subheaders, fall back to sentence splitting
                    const sentences = chunkContent
                        .split(/(?<=[.!?])(?:\s+|(?=\S))/)
                        .map((s) => s.trim())
                        .filter(Boolean);

                    if (sentences.length === 1) {
                        // Single sentence that exceeds token limit
                        const splitSentences = await this.splitLongSentence(
                            sentences[0]
                        );
                        chunks.push(...splitSentences);
                    } else {
                        // Multiple sentences, use recursive binary splitting
                        const splitSentences = await this.recursiveBinarySplit(
                            sentences
                        );
                        chunks.push(...splitSentences);
                    }
                }
            }
        }

        return chunks;
    }

    private async splitBySubHeaders(
        content: string,
        subHeaders: { level: number; text: string; index: number }[]
    ): Promise<string[]> {
        // Sort subheaders by their position in the content
        subHeaders.sort((a, b) => a.index - b.index);

        const chunks: string[] = [];

        // Process each subheader
        for (let i = 0; i < subHeaders.length; i++) {
            const currentHeader = subHeaders[i];
            const nextHeader =
                i < subHeaders.length - 1 ? subHeaders[i + 1] : null;

            // Extract content between current header and next header (or end of content)
            const startIndex = currentHeader.index;
            const endIndex = nextHeader ? nextHeader.index : content.length;
            const chunkContent = content.substring(startIndex, endIndex).trim();

            // Check if this chunk is within token limit
            const tokenCount = await this.modelService.countTokens(
                chunkContent
            );

            if (tokenCount <= this.maxTokens) {
                // If within token limit, add as a single chunk
                chunks.push(chunkContent);
            } else {
                // If exceeds token limit, split by sentences
                const sentences = chunkContent
                    .split(/(?<=[.!?])(?:\s+|(?=\S))/)
                    .map((s) => s.trim())
                    .filter(Boolean);

                if (sentences.length === 1) {
                    // Single sentence that exceeds token limit
                    const splitSentences = await this.splitLongSentence(
                        sentences[0]
                    );
                    chunks.push(...splitSentences);
                } else {
                    // Multiple sentences, use recursive binary splitting
                    const splitSentences = await this.recursiveBinarySplit(
                        sentences
                    );
                    chunks.push(...splitSentences);
                }
            }
        }

        return chunks;
    }

    private async recursiveBinarySplit(sentences: string[]): Promise<string[]> {
        // Base case: if we have no sentences, return empty array
        if (sentences.length === 0) {
            return [];
        }

        // If we have a single sentence, check if it needs further splitting
        if (sentences.length === 1) {
            const tokenCount = await this.modelService.countTokens(
                sentences[0]
            );
            if (tokenCount <= this.maxTokens) {
                return [sentences[0]];
            }

            return this.splitLongSentence(sentences[0]);
        }

        // Find the middle point
        const mid = Math.floor(sentences.length / 2);

        // Create left and right halves
        const leftHalf = sentences.slice(0, mid);
        const rightHalf = sentences.slice(mid);

        // Join the sentences in each half
        const leftContent = leftHalf.join(" ");
        const rightContent = rightHalf.join(" ");

        // Check token count for each half
        const leftTokenCount = await this.modelService.countTokens(leftContent);
        const rightTokenCount = await this.modelService.countTokens(
            rightContent
        );

        // If both halves are within token limit, return them
        if (
            leftTokenCount <= this.maxTokens &&
            rightTokenCount <= this.maxTokens
        ) {
            return [leftContent, rightContent];
        }

        // If left half is within token limit but right half isn't, keep left and split right
        if (leftTokenCount <= this.maxTokens) {
            return [
                leftContent,
                ...(await this.recursiveBinarySplit(rightHalf)),
            ];
        }

        // If right half is within token limit but left half isn't, keep right and split left
        if (rightTokenCount <= this.maxTokens) {
            return [
                ...(await this.recursiveBinarySplit(leftHalf)),
                rightContent,
            ];
        }

        // If both halves exceed token limit, split both
        return [
            ...(await this.recursiveBinarySplit(leftHalf)),
            ...(await this.recursiveBinarySplit(rightHalf)),
        ];
    }

    private async splitLongSentence(sentence: string): Promise<string[]> {
        // For very long sentences, split by words
        const words = sentence.split(/\s+/);

        // If we have a single word that exceeds the token limit, we can't split further
        if (words.length === 1) {
            return [sentence];
        }

        // Find the middle point
        const mid = Math.floor(words.length / 2);

        // Create left and right halves
        const leftHalf = words.slice(0, mid).join(" ");
        const rightHalf = words.slice(mid).join(" ");

        // Check token count for each half
        const leftTokenCount = await this.modelService.countTokens(leftHalf);
        const rightTokenCount = await this.modelService.countTokens(rightHalf);

        // If both halves are within token limit, return them
        if (
            leftTokenCount <= this.maxTokens &&
            rightTokenCount <= this.maxTokens
        ) {
            return [leftHalf, rightHalf];
        }

        // If left half is within token limit but right half isn't, keep left and split right
        if (leftTokenCount <= this.maxTokens) {
            return [leftHalf, ...(await this.splitLongSentence(rightHalf))];
        }

        // If right half is within token limit but left half isn't, keep right and split left
        if (rightTokenCount <= this.maxTokens) {
            return [...(await this.splitLongSentence(leftHalf)), rightHalf];
        }

        // If both halves exceed token limit, split both
        return [
            ...(await this.splitLongSentence(leftHalf)),
            ...(await this.splitLongSentence(rightHalf)),
        ];
    }
}
