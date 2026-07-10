import type { CodeBlock } from "@/domain/model/CodeBlock";
import { CodeChunk } from "@/domain/model/CodeChunk";
import type { Note } from "@/domain/model/Note";
import type { CodeChunkingService } from "@/domain/service/CodeChunkingService";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";

type TokenCounter = Pick<EmbeddingService, "countTokens" | "getMaxTokens">;

interface PendingCodeChunk {
    block: CodeBlock;
    content: string;
    blockChunkIndex: number;
    totalBlockChunks: number;
}

/**
 * Keeps complete source lines together whenever they fit. A single line is
 * split only when that line alone exceeds the embedding model's token limit.
 */
export class LinePreservingCodeChunkingService implements CodeChunkingService {
    constructor(private readonly embeddingService: TokenCounter) {}

    async init(): Promise<void> {
        return Promise.resolve();
    }

    async split(note: Note, codeBlocks: CodeBlock[]): Promise<CodeChunk[]> {
        const maxTokens = this.embeddingService.getMaxTokens();
        if (!Number.isInteger(maxTokens) || maxTokens < 1) {
            throw new Error(
                `Code embedding model returned invalid max token count: ${maxTokens}`
            );
        }

        const pending: PendingCodeChunk[] = [];
        for (const block of codeBlocks) {
            if (!block.content.trim()) continue;

            const contents = await this.splitContent(block.content, maxTokens);
            contents.forEach((content, blockChunkIndex) => {
                pending.push({
                    block,
                    content,
                    blockChunkIndex,
                    totalBlockChunks: contents.length,
                });
            });
        }

        return pending.map(
            ({ block, content, blockChunkIndex, totalBlockChunks }, index) =>
                new CodeChunk(
                    note.path,
                    note.title,
                    content,
                    index,
                    pending.length,
                    [],
                    block.blockIndex,
                    blockChunkIndex,
                    totalBlockChunks,
                    block.language,
                    block.info
                )
        );
    }

    private async splitContent(
        content: string,
        maxTokens: number
    ): Promise<string[]> {
        const chunks: string[] = [];
        let current = "";

        for (const line of splitIntoLineUnits(content)) {
            const candidate = current + line;
            if (
                candidate &&
                (await this.embeddingService.countTokens(candidate)) <= maxTokens
            ) {
                current = candidate;
                continue;
            }

            if (current) {
                chunks.push(current);
                current = "";
            }

            if ((await this.embeddingService.countTokens(line)) <= maxTokens) {
                current = line;
                continue;
            }

            const pieces = await this.splitOversizedLine(line, maxTokens);
            chunks.push(...pieces.slice(0, -1));
            current = pieces[pieces.length - 1];
        }

        if (current) chunks.push(current);
        return chunks;
    }

    private async splitOversizedLine(
        line: string,
        maxTokens: number
    ): Promise<string[]> {
        const pieces: string[] = [];
        let remaining = line;

        while (remaining) {
            let low = 1;
            let high = remaining.length;
            let bestLength = 0;

            while (low <= high) {
                const midpoint = Math.floor((low + high) / 2);
                const candidate = remaining.slice(0, midpoint);
                const tokenCount =
                    await this.embeddingService.countTokens(candidate);

                if (tokenCount <= maxTokens) {
                    bestLength = midpoint;
                    low = midpoint + 1;
                } else {
                    high = midpoint - 1;
                }
            }

            if (bestLength === 0) {
                throw new Error(
                    "Code embedding model cannot fit a single character within its token limit"
                );
            }

            pieces.push(remaining.slice(0, bestLength));
            remaining = remaining.slice(bestLength);
        }

        return pieces;
    }
}

function splitIntoLineUnits(content: string): string[] {
    return content.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
}
