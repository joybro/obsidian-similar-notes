import type { NoteChunkDTO } from "./NoteChunkDTO";

/**
 * chunkIndex reserved for a note's title row: one extra chunk per note whose
 * content is the title and whose embedding is embedText(title). Body chunks
 * use chunkIndex >= 0. See docs/title-vector-spec.md.
 */
export const TITLE_CHUNK_INDEX = -1;

export function isTitleChunk(chunk: { chunkIndex: number }): boolean {
    return chunk.chunkIndex < 0;
}

/** Note title as VaultNoteRepository derives it: the file basename. */
export function titleFromPath(path: string): string {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return name.endsWith(".md") ? name.slice(0, -3) : name;
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
     * returns a new NoteChunk with the embedding set.
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

    /** Builds the title row of a note (see TITLE_CHUNK_INDEX). */
    static titleChunk(
        path: string,
        title: string,
        totalChunks: number,
        embedding: number[]
    ): NoteChunk {
        return new NoteChunk(
            path,
            title,
            title,
            TITLE_CHUNK_INDEX,
            totalChunks,
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
