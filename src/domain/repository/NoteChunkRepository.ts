import type { LogLevelDesc } from "loglevel";
import type { NoteChunk } from "@/domain/model/NoteChunk";

export interface NoteChunkRepository {
    /**
     * Sets the log level for the repository
     */
    setLogLevel?(level: LogLevelDesc): void;
    init(vectorSize: number, vaultId: string, loadExistingData: boolean): Promise<void>;

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
     * Gets all NoteChunks associated with a specific file path.
     * @returns An array of NoteChunks for the given path
     */
    getByPath(path: string): Promise<NoteChunk[]>;

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
     * Dispose the repository and clean up resources
     * Should be called when the plugin is unloaded
     */
    dispose(): Promise<void>;
}
