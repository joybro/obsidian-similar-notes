import log from "loglevel";
import { BehaviorSubject, type Observable } from "rxjs";
import { IndexedDBMTimeStorage } from "./IndexedDBMTimeStorage";

export class IndexedNoteMTimeStore {
    private mtimes: Record<string, number> = {};
    private indexedNoteCount$ = new BehaviorSubject<number>(0);
    private storage: IndexedDBMTimeStorage;
    private vaultId: string = "";

    constructor() {
        this.storage = new IndexedDBMTimeStorage();
    }

    /**
     * Initialize the store with IndexedDB
     * @param vaultId - Unique identifier for the vault (app.appId)
     */
    async init(vaultId: string): Promise<void> {
        this.vaultId = vaultId;

        // Initialize IndexedDB storage
        await this.storage.init(vaultId);

        // Load all mtimes from IndexedDB to memory cache
        this.mtimes = await this.storage.getAll();
        const noteCount = Object.keys(this.mtimes).length;
        this.indexedNoteCount$.next(noteCount);
        log.info("Loaded", noteCount, "modification times from IndexedDB");
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
