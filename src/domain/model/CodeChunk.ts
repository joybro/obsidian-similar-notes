import { NoteChunk } from "./NoteChunk";

/**
 * A line-preserving piece of a fenced code block.
 *
 * CodeChunk extends NoteChunk so the existing vector repository can store it;
 * the code-specific metadata remains available while embeddings are generated.
 */
export class CodeChunk extends NoteChunk {
    constructor(
        path: string,
        title: string,
        content: string,
        chunkIndex: number,
        totalChunks: number,
        embedding: number[],
        public readonly blockIndex: number,
        public readonly blockChunkIndex: number,
        public readonly totalBlockChunks: number,
        public readonly language: string | null,
        public readonly info: string
    ) {
        super(path, title, content, chunkIndex, totalChunks, embedding);
    }

    override withEmbedding(embedding: number[]): CodeChunk {
        return new CodeChunk(
            this.path,
            this.title,
            this.content,
            this.chunkIndex,
            this.totalChunks,
            embedding,
            this.blockIndex,
            this.blockChunkIndex,
            this.totalBlockChunks,
            this.language,
            this.info
        );
    }
}
