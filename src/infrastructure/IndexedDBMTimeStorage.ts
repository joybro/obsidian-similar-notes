import log from "loglevel";

/**
 * MTime entry stored in IndexedDB
 */
export interface MTimeEntry {
    path: string; // Primary key
    mtime: number; // Last modified timestamp
}

/**
 * Metadata stored in IndexedDB for tracking migration status
 */
interface Metadata {
    key: string;
    value: boolean;
    timestamp: number;
}

/**
 * IndexedDB-based storage for file modification times
 * Provides persistent storage for tracking indexed notes
 */
export class IndexedDBMTimeStorage {
    private dbName = "";
    private readonly mtimesStoreName = "mtimes";
    private readonly metadataStoreName = "metadata";
    private readonly version = 1;
    private db: IDBDatabase | null = null;

    /**
     * Initialize the IndexedDB database
     * @param vaultId - Unique identifier for the vault (app.appId)
     */
    async init(vaultId: string): Promise<void> {
        // Use Obsidian's naming pattern: {vaultId}-{purpose}
        this.dbName = `${vaultId}-similar-notes-mtimes`;
        log.info(`Initializing IndexedDB for mtimes: ${this.dbName}`);

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                log.error("Failed to open IndexedDB:", request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                log.info("IndexedDB for mtimes initialized successfully");
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // Create mtimes object store
                if (!db.objectStoreNames.contains(this.mtimesStoreName)) {
                    db.createObjectStore(
                        this.mtimesStoreName,
                        { keyPath: "path" }
                    );
                    log.info("Created mtimes object store");
                }

                // Create metadata object store
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
     * Get modification time for a specific path
     */
    async get(path: string): Promise<number | undefined> {
        this.ensureInitialized();
        const db = this.db;
        if (!db) {
            throw new Error("Database not initialized");
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(
                [this.mtimesStoreName],
                "readonly"
            );
            const store = transaction.objectStore(this.mtimesStoreName);
            const request = store.get(path);

            request.onsuccess = () => {
                const entry = request.result as MTimeEntry | undefined;
                resolve(entry?.mtime);
            };

            request.onerror = () => {
                log.error("Failed to get mtime:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Set modification time for a specific path
     */
    async set(path: string, mtime: number): Promise<void> {
        this.ensureInitialized();
        const db = this.db;
        if (!db) {
            throw new Error("Database not initialized");
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(
                [this.mtimesStoreName],
                "readwrite"
            );
            const store = transaction.objectStore(this.mtimesStoreName);
            const entry: MTimeEntry = { path, mtime };
            const request = store.put(entry);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                log.error("Failed to set mtime:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Delete modification time for a specific path
     */
    async delete(path: string): Promise<void> {
        this.ensureInitialized();
        const db = this.db;
        if (!db) {
            throw new Error("Database not initialized");
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(
                [this.mtimesStoreName],
                "readwrite"
            );
            const store = transaction.objectStore(this.mtimesStoreName);
            const request = store.delete(path);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                log.error("Failed to delete mtime:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Get all modification times as a map
     */
    async getAll(): Promise<Record<string, number>> {
        this.ensureInitialized();
        const db = this.db;
        if (!db) {
            throw new Error("Database not initialized");
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(
                [this.mtimesStoreName],
                "readonly"
            );
            const store = transaction.objectStore(this.mtimesStoreName);
            const request = store.getAll();

            request.onsuccess = () => {
                const entries = request.result as MTimeEntry[];
                const mtimes: Record<string, number> = {};
                for (const entry of entries) {
                    mtimes[entry.path] = entry.mtime;
                }
                resolve(mtimes);
            };

            request.onerror = () => {
                log.error("Failed to get all mtimes:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Clear all modification times
     */
    async clear(): Promise<void> {
        this.ensureInitialized();
        const db = this.db;
        if (!db) {
            throw new Error("Database not initialized");
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(
                [this.mtimesStoreName],
                "readwrite"
            );
            const store = transaction.objectStore(this.mtimesStoreName);
            const request = store.clear();

            request.onsuccess = () => {
                log.info("Cleared all mtimes from IndexedDB");
                resolve();
            };

            request.onerror = () => {
                log.error("Failed to clear mtimes:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Check if migration from JSON has been completed
     */
    async getMigrationFlag(): Promise<boolean> {
        this.ensureInitialized();
        const db = this.db;
        if (!db) {
            throw new Error("Database not initialized");
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(
                [this.metadataStoreName],
                "readonly"
            );
            const store = transaction.objectStore(this.metadataStoreName);
            const request = store.get("migrated");

            request.onsuccess = () => {
                const metadata = request.result as Metadata | undefined;
                resolve(metadata?.value === true);
            };

            request.onerror = () => {
                log.error("Failed to get migration flag:", request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Set migration flag to indicate JSON migration is complete
     */
    async setMigrationFlag(value: boolean): Promise<void> {
        this.ensureInitialized();
        const db = this.db;
        if (!db) {
            throw new Error("Database not initialized");
        }

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(
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
     */
    close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
            log.info("IndexedDB for mtimes closed");
        }
    }

    private ensureInitialized(): void {
        if (!this.db) {
            throw new Error(
                "IndexedDBMTimeStorage not initialized. Call init() first."
            );
        }
    }
}
