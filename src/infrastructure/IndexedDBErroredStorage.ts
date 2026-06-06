import log from "loglevel";

/**
 * A note that failed indexing terminally (after exhausting retries).
 */
export interface ErroredNoteEntry {
    path: string; // Primary key
    error: string; // Human-readable failure reason (last error message)
    attempts: number; // How many times processing was attempted before giving up
    mtime?: number; // File mtime at the time it errored (used to detect offline edits)
    lastTriedAt: number; // Epoch ms of the last attempt
}

/**
 * IndexedDB-based storage for terminally-errored notes.
 * Parallels IndexedDBMTimeStorage; persisted per vault so the Errored state
 * survives restarts and the same note is not blindly re-queued (and re-crashed)
 * on every launch.
 */
export class IndexedDBErroredStorage {
    private dbName = "";
    private readonly storeName = "errored";
    private readonly version = 1;
    private db: IDBDatabase | null = null;

    /**
     * Initialize the IndexedDB database
     * @param vaultId - Unique identifier for the vault (app.appId)
     */
    async init(vaultId: string): Promise<void> {
        this.dbName = `${vaultId}-similar-notes-errored`;
        log.info(`Initializing IndexedDB for errored notes: ${this.dbName}`);

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                log.error("Failed to open errored IndexedDB:", request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                log.info("IndexedDB for errored notes initialized successfully");
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: "path" });
                    log.info("Created errored object store");
                }
            };
        });
    }

    /**
     * Insert or update an errored entry
     */
    async set(entry: ErroredNoteEntry): Promise<void> {
        const db = this.ensureDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.storeName], "readwrite");
            const request = tx.objectStore(this.storeName).put(entry);
            request.onsuccess = () => resolve();
            request.onerror = () => {
                log.error("Failed to set errored entry:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Delete an errored entry by path
     */
    async delete(path: string): Promise<void> {
        const db = this.ensureDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.storeName], "readwrite");
            const request = tx.objectStore(this.storeName).delete(path);
            request.onsuccess = () => resolve();
            request.onerror = () => {
                log.error("Failed to delete errored entry:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Get all errored entries as a path-keyed map
     */
    async getAll(): Promise<Record<string, ErroredNoteEntry>> {
        const db = this.ensureDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.storeName], "readonly");
            const request = tx.objectStore(this.storeName).getAll();
            request.onsuccess = () => {
                const entries = request.result as ErroredNoteEntry[];
                const map: Record<string, ErroredNoteEntry> = {};
                for (const entry of entries) {
                    map[entry.path] = entry;
                }
                resolve(map);
            };
            request.onerror = () => {
                log.error("Failed to get all errored entries:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Clear all errored entries
     */
    async clear(): Promise<void> {
        const db = this.ensureDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.storeName], "readwrite");
            const request = tx.objectStore(this.storeName).clear();
            request.onsuccess = () => {
                log.info("Cleared all errored entries from IndexedDB");
                resolve();
            };
            request.onerror = () => {
                log.error("Failed to clear errored entries:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Close the database connection
     */
    close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
            log.info("IndexedDB for errored notes closed");
        }
    }

    private ensureDb(): IDBDatabase {
        if (!this.db) {
            throw new Error(
                "IndexedDBErroredStorage not initialized. Call init() first."
            );
        }
        return this.db;
    }
}
