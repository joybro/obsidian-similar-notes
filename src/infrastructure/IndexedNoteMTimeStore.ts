import log from "loglevel";
import type { Vault } from "obsidian";
import type { SettingsService } from "../application/SettingsService";
import { BehaviorSubject, type Observable } from "rxjs";

export class IndexedNoteMTimeStore {
    private mtimes: Record<string, number> = {};
    private indexedNoteCount$ = new BehaviorSubject<number>(0);

    constructor(
        private vault: Vault,
        private settingsService: SettingsService
    ) {}
    
    /**
     * Clears all stored modification times
     * Used when reindexing all notes
     */
    clear(): void {
        this.mtimes = {};
        this.indexedNoteCount$.next(0);
        log.info("Cleared all stored modification times");
    }

    getMTime(path: string): number {
        return this.mtimes[path];
    }

    setMTime(path: string, mtime: number): void {
        const isNewPath = this.mtimes[path] === undefined;
        this.mtimes[path] = mtime;
        
        // If this is a new path, increment the count
        if (isNewPath) {
            const currentCount = this.indexedNoteCount$.getValue();
            this.indexedNoteCount$.next(currentCount + 1);
        }
    }

    deleteMTime(path: string): void {
        const existed = this.mtimes[path] !== undefined;
        delete this.mtimes[path];
        
        // If the path existed, decrement the count
        if (existed) {
            const currentCount = this.indexedNoteCount$.getValue();
            this.indexedNoteCount$.next(currentCount - 1);
        }
    }

    getAllPaths(): string[] {
        return Object.keys(this.mtimes);
    }

    async persist(): Promise<void> {
        await this.vault.adapter.write(
            this.settingsService.get().fileMtimePath,
            JSON.stringify(this.mtimes)
        );
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
    
    async restore(): Promise<void> {
        const exist = await this.vault.adapter.exists(
            this.settingsService.get().fileMtimePath
        );

        if (!exist) {
            this.mtimes = {};
            return;
        }

        const data = await this.vault.adapter.read(
            this.settingsService.get().fileMtimePath
        );
        try {
            this.mtimes = JSON.parse(data);
            const noteCount = Object.keys(this.mtimes).length;
            this.indexedNoteCount$.next(noteCount);
            log.info("Restored modification times for", noteCount, "files");
        } catch (e) {
            log.error("Failed to restore modification times:", e);
        }
    }
}
