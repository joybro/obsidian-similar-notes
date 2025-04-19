/**
 * Interface for embedded notes
 * A single Obsidian note can be split into multiple EmbeddedChunks
 */
export interface EmbeddedChunk {
    path: string; // Original file path
    title: string; // File title (extracted from filename)
    embedding: number[]; // Embedding vector
    lastUpdated: number; // Last update timestamp
    content: string; // Actual embedded text content (full or partial)
    chunkIndex: number; // Chunk index within the same document (when split)
    totalChunks: number; // Total number of chunks (when split)
}

export interface SearchResult {
    chunk: EmbeddedChunk;
    score: number; // Similarity score (0-1)
}

export interface EmbeddedChunkStore {
    /**
     * Initialize the store
     */
    init(): Promise<void>;

    /**
     * Clear the store
     */
    clear(): Promise<void>;

    /**
     * Close storage (save to disk and terminate connection)
     */
    close(): Promise<void>;

    /**
     * Save current state to disk
     */
    save(): Promise<void>;

    /**
     * Load data from disk
     */
    load(filepath: string): Promise<void>;

    /**
     * Add a new note embedding
     * @param chunk Embedded note object
     */
    add(chunk: EmbeddedChunk): Promise<void>;

    /**
     * Batch add multiple note embeddings
     * @param chunks Array of embedded note objects
     */
    addMulti(chunks: EmbeddedChunk[]): Promise<void>;

    /**
     * Search notes by file path (returns all chunks for the given path)
     * @param path File path
     */
    getByPath(path: string): Promise<EmbeddedChunk[]>;

    /**
     * Delete note embeddings by file path (removes all chunks for the given path)
     * @param path File path
     */
    removeByPath(path: string): Promise<void>;

    /**
     * Search embeddings (similarity-based)
     * @param embedding Search embedding vector
     * @param limit Maximum number of results
     * @param excludePaths Array of file paths to exclude from search
     */
    searchSimilar(
        embedding: number[],
        limit: number,
        minScore?: number,
        excludePaths?: string[]
    ): Promise<SearchResult[]>;
}
