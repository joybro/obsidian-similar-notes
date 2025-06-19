import type { NoteChunk } from "@/domain/model/NoteChunk";

export interface NoteChunkRepository {
    init(vectorSize: number, filepath: string, restore: boolean): Promise<void>;

    /**
     * Puts a NoteChunk.
     * If a chunk with the same chunkId exists, it will be overwritten.
     */
    put(noteChunk: NoteChunk): Promise<void>;

    /**
     * Puts multiple NoteChunks.
     */
    putMulti(noteChunks: NoteChunk[]): Promise<void>;

    /**
     * Removes all NoteChunks associated with a specific file path.
     * @returns A boolean indicating whether any chunks were actually removed
     */
    removeByPath(path: string): Promise<boolean>;

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
    ): Promise<{ chunk: NoteChunk; score: number }[]>;

    /**
     * Returns the total number of stored NoteChunks.
     */
    count(): Promise<number>;

    /**
     * Returns the number of unique notes (documents) in the index.
     * This counts each note once, regardless of how many chunks it contains.
     */
    countUniqueNotes(): Promise<number>;

    /**
     * Persists NoteChunks in memory to disk.
     */
    persist(): Promise<void>;
}
