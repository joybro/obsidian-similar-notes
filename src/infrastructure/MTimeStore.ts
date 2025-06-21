import log from "loglevel";
import type { Vault } from "obsidian";
import type { SettingsService } from "../application/SettingsService";

export class MTimeStore {
    private mtimes: Record<string, number> = {};

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
        log.info("Cleared all stored modification times");
    }

    getMTime(path: string): number {
        return this.mtimes[path];
    }

    setMTime(path: string, mtime: number): void {
        this.mtimes[path] = mtime;
    }

    deleteMTime(path: string): void {
        delete this.mtimes[path];
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
        this.mtimes = JSON.parse(data);
        log.info("restored mtimes count", Object.keys(this.mtimes).length);
    }
}
