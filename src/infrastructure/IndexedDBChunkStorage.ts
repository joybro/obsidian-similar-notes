import log from "loglevel";

/**
 * Internal chunk structure stored in IndexedDB
 * Includes pathHash for compatibility with Orama
 */
export interface NoteChunkInternal {
    id?: number; // Auto-increment key from IndexedDB
    path: string;
    pathHash: string;
    title: string;
    content: string;
    chunkIndex: number;
    totalChunks: number;
    embedding: number[];
    lastUpdated: number;
}

/**
 * Metadata stored in IndexedDB for tracking migration status
 */
interface Metadata {
    key: string;
    value: any;
    timestamp: number;
}

/**
 * IndexedDB-based storage for note chunks
 * Provides memory-efficient batch loading and persistence
 */
export class IndexedDBChunkStorage {
    private dbName: string = "";
    private readonly chunksStoreName = "chunks";
    private readonly metadataStoreName = "metadata";
    private readonly version = 1;
    private db: IDBDatabase | null = null;

    /**
     * Initialize the IndexedDB database
     * Creates object stores and indexes if they don't exist
     * @param vaultId - Unique identifier for the vault (app.appId)
     */
    async init(vaultId: string): Promise<void> {
        // Use Obsidian's naming pattern: {vaultId}-{purpose}
        this.dbName = `${vaultId}-similar-notes`;
        log.info(`Initializing IndexedDB: ${this.dbName}`);
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                log.error("Failed to open IndexedDB:", request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                log.info("IndexedDB initialized successfully");
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // Create chunks store
                if (!db.objectStoreNames.contains(this.chunksStoreName)) {
                    const chunksStore = db.createObjectStore(
                        this.chunksStoreName,
                        { keyPath: "id", autoIncrement: true }
                    );

                    // Create indexes for efficient querying
                    chunksStore.createIndex("path", "path", { unique: false });
                    chunksStore.createIndex("pathHash", "pathHash", {
                        unique: false,
                    });

                    log.info("Created chunks object store with indexes");
                }

                // Create metadata store
                if (!db.objectStoreNames.contains(this.metadataStoreName)) {
                    db.createObjectStore(this.metadataStoreName, {
                        keyPath: "key",
                    });

                    log.info("Created metadata object store");
                }
            };
        });
    }

    /**
     * Insert a single chunk into IndexedDB
     */
    async put(chunk: NoteChunkInternal): Promise<void> {
        this.ensureInitialized();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(
                [this.chunksStoreName],
                "readwrite"
            );
            const store = transaction.objectStore(this.chunksStoreName);

            const request = store.add(chunk);

            request.onsuccess = () => resolve();
            request.onerror = () => {
                log.error("Failed to insert chunk:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Insert multiple chunks in a single transaction
     * More efficient than calling put() multiple times
     */
    async putMulti(chunks: NoteChunkInternal[]): Promise<void> {
        this.ensureInitialized();

        if (chunks.length === 0) {
            return;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(
                [this.chunksStoreName],
                "readwrite"
            );
            const store = transaction.objectStore(this.chunksStoreName);

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => {
                log.error("Failed to insert chunks:", transaction.error);
                reject(transaction.error);
            };

            for (const chunk of chunks) {
                store.add(chunk);
            }
        });
    }

    /**
     * Get all chunks for a given note path
     * Returns an array of chunks
     */
    async getByPath(path: string): Promise<NoteChunkInternal[]> {
        this.ensureInitialized();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(
                [this.chunksStoreName],
                "readonly"
            );
            const store = transaction.objectStore(this.chunksStoreName);
            const index = store.index("path");

            const request = index.openCursor(IDBKeyRange.only(path));
            const chunks: NoteChunkInternal[] = [];

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue>)
                    .result;

                if (cursor) {
                    chunks.push(cursor.value);
                    cursor.continue();
                } else {
                    // No more matching records
                    resolve(chunks);
                }
            };

            request.onerror = () => {
                log.error("Failed to get chunks by path:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Remove all chunks for a given note path
     * Returns the number of chunks removed
     */
    async removeByPath(path: string): Promise<number> {
        this.ensureInitialized();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(
                [this.chunksStoreName],
                "readwrite"
            );
            const store = transaction.objectStore(this.chunksStoreName);
            const index = store.index("path");

            const request = index.openCursor(IDBKeyRange.only(path));
            let removedCount = 0;

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue>)
                    .result;

                if (cursor) {
                    cursor.delete();
                    removedCount++;
                    cursor.continue();
                } else {
                    // No more matching records
                    resolve(removedCount);
                }
            };

            request.onerror = () => {
                log.error("Failed to remove chunks by path:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Get the total number of chunks in the database
     */
    async count(): Promise<number> {
        this.ensureInitialized();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(
                [this.chunksStoreName],
                "readonly"
            );
            const store = transaction.objectStore(this.chunksStoreName);
            const request = store.count();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                log.error("Failed to count chunks:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Load all chunks in batches to avoid memory issues
     * Calls onBatch for each batch of chunks
     * Optionally calls onProgress to report loading progress
     *
     * @param batchSize Number of chunks per batch (recommended: 100)
     * @param onBatch Callback function called with each batch
     * @param onProgress Optional callback for progress reporting
     */
    async loadInBatches(
        batchSize: number,
        onBatch: (chunks: NoteChunkInternal[]) => Promise<void>,
        onProgress?: (processed: number, total: number) => void
    ): Promise<void> {
        this.ensureInitialized();

        const total = await this.count();
        let processed = 0;

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(
                [this.chunksStoreName],
                "readonly"
            );
            const store = transaction.objectStore(this.chunksStoreName);
            const request = store.openCursor();

            let batch: NoteChunkInternal[] = [];

            request.onsuccess = async (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue>)
                    .result;

                if (cursor) {
                    // Remove the IndexedDB id field before passing to Orama
                    const { id, ...chunk } = cursor.value;
                    batch.push(chunk as NoteChunkInternal);

                    if (batch.length >= batchSize) {
                        try {
                            await onBatch([...batch]);
                            processed += batch.length;

                            if (onProgress) {
                                onProgress(processed, total);
                            }

                            batch = [];
                        } catch (error) {
                            log.error("Error processing batch:", error);
                            reject(error);
                            return;
                        }
                    }

                    cursor.continue();
                } else {
                    // No more records - process final batch if any
                    if (batch.length > 0) {
                        try {
                            await onBatch([...batch]);
                            processed += batch.length;

                            if (onProgress) {
                                onProgress(processed, total);
                            }
                        } catch (error) {
                            log.error("Error processing final batch:", error);
                            reject(error);
                            return;
                        }
                    }

                    resolve();
                }
            };

            request.onerror = () => {
                log.error("Failed to load chunks in batches:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Remove all chunks from the database
     * Useful for testing or when changing models
     */
    async clear(): Promise<void> {
        this.ensureInitialized();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(
                [this.chunksStoreName],
                "readwrite"
            );
            const store = transaction.objectStore(this.chunksStoreName);
            const request = store.clear();

            request.onsuccess = () => {
                log.info("Cleared all chunks from IndexedDB");
                resolve();
            };

            request.onerror = () => {
                log.error("Failed to clear chunks:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Get migration flag from metadata store
     * Returns true if migration from JSON to IndexedDB has been completed
     */
    async getMigrationFlag(): Promise<boolean> {
        this.ensureInitialized();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(
                [this.metadataStoreName],
                "readonly"
            );
            const store = transaction.objectStore(this.metadataStoreName);
            const request = store.get("migrated");

            request.onsuccess = () => {
                const metadata = request.result as Metadata | undefined;
                resolve(metadata?.value ?? false);
            };

            request.onerror = () => {
                log.error("Failed to get migration flag:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Set migration flag in metadata store
     * Used to track whether JSON to IndexedDB migration has been completed
     */
    async setMigrationFlag(value: boolean): Promise<void> {
        this.ensureInitialized();

        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(
                [this.metadataStoreName],
                "readwrite"
            );
            const store = transaction.objectStore(this.metadataStoreName);

            const metadata: Metadata = {
                key: "migrated",
                value,
                timestamp: Date.now(),
            };

            const request = store.put(metadata);

            request.onsuccess = () => {
                log.info(`Migration flag set to: ${value}`);
                resolve();
            };

            request.onerror = () => {
                log.error("Failed to set migration flag:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Close the database connection
     * Should be called when the plugin is unloaded
     */
    async close(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
            log.info("IndexedDB connection closed");
        }
    }

    /**
     * Ensure the database is initialized before operations
     * Throws an error if not initialized
     */
    private ensureInitialized(): void {
        if (!this.db) {
            throw new Error(
                "IndexedDB not initialized. Call init() first."
            );
        }
    }
}
