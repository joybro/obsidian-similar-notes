import type { NoteChunkDTO } from "./NoteChunkDTO";

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
