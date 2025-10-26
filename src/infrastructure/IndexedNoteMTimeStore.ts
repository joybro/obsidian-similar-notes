import log from "loglevel";
import type { Vault } from "obsidian";
import { BehaviorSubject, type Observable } from "rxjs";
import { IndexedDBMTimeStorage } from "./IndexedDBMTimeStorage";

export class IndexedNoteMTimeStore {
    private mtimes: Record<string, number> = {};
    private indexedNoteCount$ = new BehaviorSubject<number>(0);
    private storage: IndexedDBMTimeStorage;
    private vaultId: string = "";
    private jsonPath: string = "";

    constructor(private vault: Vault, fileMtimePath: string) {
        this.storage = new IndexedDBMTimeStorage();
        this.jsonPath = fileMtimePath;
    }

    /**
     * Initialize the store with IndexedDB
     * @param vaultId - Unique identifier for the vault (app.appId)
     */
    async init(vaultId: string): Promise<void> {
        this.vaultId = vaultId;

        // Initialize IndexedDB storage
        await this.storage.init(vaultId);

        // Check if migration is needed
        const alreadyMigrated = await this.storage.getMigrationFlag();
        const jsonExists = await this.vault.adapter.exists(this.jsonPath);

        if (!alreadyMigrated && jsonExists) {
            // Perform one-time migration from JSON to IndexedDB
            await this.migrateFromJSON();
        }

        // Load all mtimes from IndexedDB to memory cache
        this.mtimes = await this.storage.getAll();
        const noteCount = Object.keys(this.mtimes).length;
        this.indexedNoteCount$.next(noteCount);
        log.info("Loaded", noteCount, "modification times from IndexedDB");
    }

    /**
     * Migrate existing JSON data to IndexedDB
     * This is a one-time operation performed on first load after upgrade
     */
    private async migrateFromJSON(): Promise<void> {
        try {
            log.info("Starting migration from JSON to IndexedDB for mtimes");

            // Read JSON file
            const jsonData = await this.vault.adapter.read(this.jsonPath);
            const mtimes = JSON.parse(jsonData) as Record<string, number>;

            // Migrate to IndexedDB
            const entries = Object.entries(mtimes);
            log.info(`Migrating ${entries.length} mtime entries to IndexedDB`);

            for (const [path, mtime] of entries) {
                await this.storage.set(path, mtime);
            }

            // Set migration flag
            await this.storage.setMigrationFlag(true);

            // Backup JSON file
            const backupPath = `${this.jsonPath}.backup-${Date.now()}`;
            await this.vault.adapter.rename(this.jsonPath, backupPath);
            log.info(`Migration complete. JSON backed up to: ${backupPath}`);
        } catch (error) {
            log.error("Failed to migrate mtimes from JSON:", error);
            throw error;
        }
    }

    /**
     * Clears all stored modification times
     * Used when reindexing all notes
     */
    async clear(): Promise<void> {
        this.mtimes = {};
        this.indexedNoteCount$.next(0);
        await this.storage.clear();
        log.info("Cleared all stored modification times");
    }

    getMTime(path: string): number {
        return this.mtimes[path];
    }

    async setMTime(path: string, mtime: number): Promise<void> {
        const isNewPath = this.mtimes[path] === undefined;
        this.mtimes[path] = mtime;

        // Save to IndexedDB
        await this.storage.set(path, mtime);

        // If this is a new path, increment the count
        if (isNewPath) {
            const currentCount = this.indexedNoteCount$.getValue();
            this.indexedNoteCount$.next(currentCount + 1);
        }
    }

    async deleteMTime(path: string): Promise<void> {
        const existed = this.mtimes[path] !== undefined;
        delete this.mtimes[path];

        // Delete from IndexedDB
        await this.storage.delete(path);

        // If the path existed, decrement the count
        if (existed) {
            const currentCount = this.indexedNoteCount$.getValue();
            this.indexedNoteCount$.next(currentCount - 1);
        }
    }

    getAllPaths(): string[] {
        return Object.keys(this.mtimes);
    }

    /**
     * Get an Observable of the indexed note count
     */
    getIndexedNoteCount$(): Observable<number> {
        return this.indexedNoteCount$;
    }

    /**
     * Get the current indexed note count
     */
    getCurrentIndexedNoteCount(): number {
        return this.indexedNoteCount$.getValue();
    }

    /**
     * @deprecated Use init() instead. This method is kept for backward compatibility.
     */
    async restore(): Promise<void> {
        log.warn(
            "restore() is deprecated. Data is loaded automatically in init()."
        );
    }
}
