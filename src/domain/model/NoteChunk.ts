import type { NoteChunkDTO } from "./NoteChunkDTO";

export interface EmbeddedChunk {
    path: string; // Original file path
    pathHash: string; // SHA-256 hash of the file path
    title: string; // File title (extracted from filename)
    embedding: number[]; // Embedding vector
    lastUpdated: number; // Last update timestamp
    content: string; // Actual embedded text content (full or partial)
    chunkIndex: number; // Chunk index within the same document (when split)
    totalChunks: number; // Total number of chunks (when split)
}

export class NoteChunk {
    constructor(
        public readonly path: string,
        public readonly title: string,
        public readonly content: string,
        public readonly chunkIndex: number,
        public readonly totalChunks: number,
        public readonly embedding: number[]
    ) {}

    /**
     * 임베딩을 채워넣은 새로운 NoteChunk를 리턴한다 (immutable 스타일).
     */
    withEmbedding(embedding: number[]): NoteChunk {
        return new NoteChunk(
            this.path,
            this.title,
            this.content,
            this.chunkIndex,
            this.totalChunks,
            embedding
        );
    }

    toDTO(): NoteChunkDTO {
        return {
            path: this.path,
            title: this.title,
            content: this.content,
            chunkIndex: this.chunkIndex,
            totalChunks: this.totalChunks,
            embedding: this.embedding,
        };
    }

    static fromDTO(dto: NoteChunkDTO): NoteChunk {
        return new NoteChunk(
            dto.path,
            dto.title,
            dto.content,
            dto.chunkIndex,
            dto.totalChunks,
            dto.embedding
        );
    }
}
