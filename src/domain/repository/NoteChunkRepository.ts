import type { NoteChunk } from "@/domain/model/NoteChunk";

export interface NoteChunkRepository {
    /**
     * Saves a NoteChunk.
     * If a chunk with the same chunkId exists, it will be overwritten.
     */
    save(noteChunk: NoteChunk): Promise<void>;

    /**
     * Saves multiple NoteChunks.
     */
    saveMulti(noteChunks: NoteChunk[]): Promise<void>;

    /**
     * Deletes all NoteChunks associated with a specific file path.
     */
    deleteByPath(path: string): Promise<void>;

    /**
     * Finds and returns NoteChunks that are most similar to the given embedding vector.
     *
     * @param queryEmbedding - The embedding vector to use as the search criteria
     * @param limit - Maximum number of NoteChunks to return
     */
    findSimilarChunks(
        queryEmbedding: number[],
        limit: number,
        minScore?: number,
        excludePaths?: string[]
    ): Promise<[NoteChunk, number][]>;

    /**
     * Returns the total number of stored NoteChunks.
     */
    count(): number;

    /**
     * Persists NoteChunks in memory to disk.
     */
    flush(): Promise<void>;
}
