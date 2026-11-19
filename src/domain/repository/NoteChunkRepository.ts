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
     * Transfers all chunks indexed under `oldPath` to `newPath`, preserving
     * their embeddings. Used when a file is renamed/moved without content
     * changes, so we don't re-embed.
     * @returns true if chunks existed and were transferred; false if there
     *          were no chunks for `oldPath` (caller should fall back to a
     *          full embed of `newPath`).
     */
    renamePath(oldPath: string, newPath: string): Promise<boolean>;

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
     * @param options.bodyChunksOnly - When true, title rows (chunkIndex < 0)
     *        are skipped and `limit` body chunks are still returned. Used by
     *        the Similar notes panel, which does not use title vectors.
     */
    findSimilarChunks(
        queryEmbedding: number[],
        limit: number,
        minScore?: number,
        excludePaths?: string[],
        options?: { bodyChunksOnly?: boolean }
    ): Promise<{ chunk: NoteChunk; score: number }[]>;

    /**
     * Returns the number of stored body chunks (chunkIndex >= 0). Title rows
     * are not counted.
     */
    count(): Promise<number>;

    /**
     * Paths that had body chunks but no title row when the index was loaded
     * from storage (vaults indexed before title rows existed). Used to queue
     * the title backfill once per load.
     */
    getPathsWithoutTitleChunk(): Promise<string[]>;

    /**
     * Dispose the repository and clean up resources
     * Should be called when the plugin is unloaded
     */
    dispose(): Promise<void>;
}
