import { CodeChunk } from "@/domain/model/CodeChunk";
import type { NoteChunk } from "@/domain/model/NoteChunk";

export function getChunkEmbeddingText(chunk: NoteChunk): string {
    if (chunk instanceof CodeChunk) {
        const language = chunk.language ? `Language: ${chunk.language}\n` : "";
        return `${chunk.title}\n${language}\n${chunk.content}`;
    }

    return chunk.chunkIndex === 0
        ? `${chunk.title}\n\n${chunk.content}`
        : chunk.content;
}
