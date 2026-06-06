import log from "loglevel";
import { BehaviorSubject, type Observable } from "rxjs";
import {
    IndexedDBErroredStorage,
    type ErroredNoteEntry,
} from "./IndexedDBErroredStorage";

/**
 * Tracks notes that failed indexing terminally. Mirrors IndexedNoteMTimeStore:
 * an in-memory cache backed by IndexedDB, plus a count Observable for the UI.
 */
export class ErroredNoteStore {
    private entries: Record<string, ErroredNoteEntry> = {};
    private erroredCount$ = new BehaviorSubject<number>(0);
    private storage: IndexedDBErroredStorage;

    constructor() {
        this.storage = new IndexedDBErroredStorage();
    }

    /**
     * Initialize the store with IndexedDB
     * @param vaultId - Unique identifier for the vault (app.appId)
     */
    async init(vaultId: string): Promise<void> {
        await this.storage.init(vaultId);
        this.entries = await this.storage.getAll();
        this.erroredCount$.next(Object.keys(this.entries).length);
        log.info(
            "Loaded",
            Object.keys(this.entries).length,
            "errored notes from IndexedDB"
        );
    }

    get(path: string): ErroredNoteEntry | undefined {
        return this.entries[path];
    }

    getAll(): Record<string, ErroredNoteEntry> {
        return this.entries;
    }

    getAllPaths(): string[] {
        return Object.keys(this.entries);
    }

    async set(
        path: string,
        data: { error: string; attempts: number; mtime?: number }
    ): Promise<void> {
        const isNew = this.entries[path] === undefined;
        const entry: ErroredNoteEntry = {
            path,
            error: data.error,
            attempts: data.attempts,
            mtime: data.mtime,
            lastTriedAt: Date.now(),
        };
        this.entries[path] = entry;
        await this.storage.set(entry);
        if (isNew) {
            this.erroredCount$.next(this.erroredCount$.getValue() + 1);
        }
    }

    async delete(path: string): Promise<void> {
        const existed = this.entries[path] !== undefined;
        delete this.entries[path];
        await this.storage.delete(path);
        if (existed) {
            this.erroredCount$.next(this.erroredCount$.getValue() - 1);
        }
    }

    async clear(): Promise<void> {
        this.entries = {};
        this.erroredCount$.next(0);
        await this.storage.clear();
        log.info("Cleared all errored notes");
    }

    /**
     * Get an Observable of the errored note count
     */
    getErroredCount$(): Observable<number> {
        return this.erroredCount$;
    }

    /**
     * Get the current errored note count
     */
    getCurrentErroredCount(): number {
        return this.erroredCount$.getValue();
    }
}
