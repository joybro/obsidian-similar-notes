import log from "loglevel";
import { BehaviorSubject, type Observable } from "rxjs";
import {
    IndexedDBMTimeStorage,
    type MTimeEntry,
} from "./IndexedDBMTimeStorage";

export class IndexedNoteMTimeStore {
    private entries: Record<string, MTimeEntry> = {};
    private indexedNoteCount$ = new BehaviorSubject<number>(0);
    private storage: IndexedDBMTimeStorage;
    private vaultId = "";

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

        // Load all note metadata from IndexedDB to memory cache
        this.entries = await this.storage.getAll();
        const noteCount = Object.keys(this.entries).length;
        this.indexedNoteCount$.next(noteCount);
        log.info("Loaded", noteCount, "modification times from IndexedDB");
    }

    /**
     * Clears all stored modification times
     * Used when reindexing all notes
     */
    async clear(): Promise<void> {
        await this.storage.clear();
        this.entries = {};
        this.indexedNoteCount$.next(0);
        log.info("Cleared all stored modification times");
    }

    getMTime(path: string): number {
        return this.entries[path]?.mtime;
    }

    getIndexableTextHash(path: string): string | undefined {
        return this.entries[path]?.indexableTextHash;
    }

    async setMTime(path: string, mtime: number): Promise<void> {
        await this.setMetadata(
            path,
            mtime,
            this.entries[path]?.indexableTextHash
        );
    }

    async setMetadata(
        path: string,
        mtime: number,
        indexableTextHash?: string
    ): Promise<void> {
        const entry: MTimeEntry = { path, mtime };
        if (indexableTextHash !== undefined) {
            entry.indexableTextHash = indexableTextHash;
        }

        // Save to IndexedDB
        await this.storage.set(path, mtime, indexableTextHash);
        this.entries[path] = entry;
        this.indexedNoteCount$.next(Object.keys(this.entries).length);
    }

    async moveMetadata(
        oldPath: string,
        newPath: string,
        mtime: number,
        hashOverride?: string
    ): Promise<void> {
        const indexableTextHash =
            hashOverride ?? this.entries[oldPath]?.indexableTextHash;

        await this.storage.move(
            oldPath,
            newPath,
            mtime,
            indexableTextHash
        );

        const entry: MTimeEntry = { path: newPath, mtime };
        if (indexableTextHash !== undefined) {
            entry.indexableTextHash = indexableTextHash;
        }
        delete this.entries[oldPath];
        this.entries[newPath] = entry;
        this.indexedNoteCount$.next(Object.keys(this.entries).length);
    }

    async deleteMTime(path: string): Promise<void> {
        // Delete from IndexedDB
        await this.storage.delete(path);
        delete this.entries[path];
        this.indexedNoteCount$.next(Object.keys(this.entries).length);
    }

    getAllPaths(): string[] {
        return Object.keys(this.entries);
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
