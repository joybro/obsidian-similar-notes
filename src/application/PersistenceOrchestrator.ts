import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import type { MTimeStore } from "@/infrastructure/MTimeStore";
import log from "loglevel";
import type { SettingsService } from "./SettingsService";
export class PersistenceOrchestrator {
    private autoSaveInterval: NodeJS.Timeout;

    constructor(
        private noteChunkRepository: NoteChunkRepository,
        private mTimeStore: MTimeStore,
        private settingsService: SettingsService
    ) {}

    async initializeStore(vectorSize: number) {
        try {
            await this.mTimeStore.restore();

            const dbPath = this.settingsService.get().dbPath;
            await this.noteChunkRepository.init(vectorSize, dbPath);

            await this.noteChunkRepository.restore();
            const count = this.noteChunkRepository.count();
            log.info(
                "Successfully loaded existing database from",
                dbPath,
                "with",
                count,
                "chunks"
            );

            this.setupAutoSave(this.settingsService.get().autoSaveInterval);

            this.settingsService
                .getNewSettingsObservable()
                .subscribe((newSettings) => {
                    // If auto-save interval changed, update the interval
                    if (newSettings.autoSaveInterval !== undefined) {
                        this.setupAutoSave(newSettings.autoSaveInterval);
                    }
                });
        } catch (e) {
            log.error("Failed to initialize store:", e);
            throw e;
        }
    }

    async closeStore() {
        await this.noteChunkRepository.persist();
        await this.mTimeStore.persist();
    }

    private setupAutoSave(interval: number) {
        // Clear any existing interval
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }

        // Set up new auto-save interval
        const intervalMs = interval * 60 * 1000;
        this.autoSaveInterval = setInterval(async () => {
            try {
                await this.noteChunkRepository.persist();
                await this.mTimeStore.persist();
                log.info("Auto-saved databases");
            } catch (e) {
                log.error("Failed to auto-save database:", e);
            }
        }, intervalMs);
    }
}
