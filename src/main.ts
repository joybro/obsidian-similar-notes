import log from "loglevel";
import { Plugin } from "obsidian";
import { OramaNoteChunkRepository } from "./adapter/orama/OramaNoteChunkRepository";
import { LeafViewCoordinator } from "./application/LeafViewCoordinator";
import { NoteIndexingService } from "./application/NoteIndexingService";
import { SettingsService } from "./application/SettingsService";
import { SimilarNoteCoordinator } from "./application/SimilarNoteCoordinator";
import { SimilarNotesSettingTab } from "./components/SimilarNotesSettingTab";
import { StatusBarView } from "./components/StatusBarView";
import type { NoteChunkRepository } from "./domain/repository/NoteChunkRepository";
import type { NoteRepository } from "./domain/repository/NoteRepository";
import { EmbeddingService } from "./domain/service/EmbeddingService";
import type { NoteChunkingService } from "./domain/service/NoteChunkingService";
import { SimilarNoteFinder } from "./domain/service/SimilarNoteFinder";
import { LangchainNoteChunkingService } from "./infrastructure/LangchainNoteChunkingService";
import { MTimeStore } from "./infrastructure/MTimeStore";
import { VaultNoteRepository } from "./infrastructure/VaultNoteRepository";
import { NoteChangeQueue } from "./services/noteChangeQueue";

export default class MainPlugin extends Plugin {
    private leafViewCoordinator: LeafViewCoordinator;
    private settingsService: SettingsService;
    private noteChunkRepository: NoteChunkRepository;
    private autoSaveInterval: NodeJS.Timeout;
    private noteChangeQueue: NoteChangeQueue;
    private modelService: EmbeddingService;
    private noteRepository: NoteRepository;
    private noteChunkingService: NoteChunkingService;
    private similarNoteFinder: SimilarNoteFinder;
    private similarNoteCoordinator: SimilarNoteCoordinator;
    private noteIndexingService: NoteIndexingService;
    private mTimeStore: MTimeStore;
    private statusBarView: StatusBarView;

    async onload() {
        log.setDefaultLevel(log.levels.ERROR);
        log.info("Loading Similar Notes plugin");

        this.settingsService = new SettingsService(this);
        await this.settingsService.load();

        this.noteRepository = new VaultNoteRepository(this.app);

        this.modelService = new EmbeddingService();

        this.noteChunkRepository = new OramaNoteChunkRepository(this.app.vault);

        this.mTimeStore = new MTimeStore(this.app.vault, this.settingsService);

        await this.mTimeStore.restore();

        this.noteChunkingService = new LangchainNoteChunkingService(
            this.modelService
        );

        this.similarNoteFinder = new SimilarNoteFinder(
            this.noteChunkRepository,
            this.noteChunkingService,
            this.modelService
        );

        this.similarNoteCoordinator = new SimilarNoteCoordinator(
            this.app.vault,
            this.noteRepository,
            this.similarNoteFinder,
            this.settingsService
        );

        this.leafViewCoordinator = new LeafViewCoordinator(
            this.app,
            this.similarNoteCoordinator
        );

        // Add settings tab
        this.addSettingTab(
            new SimilarNotesSettingTab(this, this.settingsService)
        );

        // Register event when current open file changes
        this.registerEvent(
            this.app.workspace.on("file-open", async (file) => {
                await this.similarNoteCoordinator.onFileOpen(file);
            })
        );

        this.registerEvent(
            this.app.workspace.on("layout-change", async () => {
                this.leafViewCoordinator.onLayoutChange();
            })
        );

        this.registerEvent(
            this.app.workspace.on("active-leaf-change", async (leaf) => {
                this.leafViewCoordinator.onActiveLeafChange(leaf);
            })
        );

        // Initialize file change queue
        this.app.workspace.onLayoutReady(async () => {
            this.noteChangeQueue = new NoteChangeQueue(
                this.app.vault,
                this.mTimeStore
            );
            await this.noteChangeQueue.initialize();

            this.noteIndexingService = new NoteIndexingService(
                this.noteRepository,
                this.noteChunkRepository,
                this.noteChangeQueue,
                this.noteChunkingService,
                this.modelService,
                this.similarNoteCoordinator,
                this.settingsService
            );

            this.statusBarView = new StatusBarView(
                this,
                this.noteIndexingService.getNoteChangeCount$(),
                this.modelService.getModelBusy$(),
                this.modelService.getDownloadProgress$()
            );

            this.init(this.settingsService.get().modelId, true, false);
        });
    }

    async onunload() {
        this.statusBarView.dispose();
        this.noteIndexingService.stopLoop();
        this.leafViewCoordinator.onUnload();

        // Clear auto-save interval
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }

        // Dispose of model service
        if (this.modelService) {
            this.modelService.dispose();
        }

        this.noteChangeQueue.cleanup();

        this.closeStore();
    }

    async init(
        modelId: string,
        firstTime: boolean,
        newModel: boolean
    ): Promise<void> {
        this.noteIndexingService.stopLoop();

        try {
            if (newModel) {
                await this.modelService.unloadModel();
            }

            if (firstTime || newModel) {
                await this.modelService.loadModel(modelId);
                log.info("Model service initialized successfully");

                this.noteChunkingService.init();
            }
        } catch (error) {
            log.error("Failed to initialize model service:", error);
            return;
        }

        const vectorSize = this.modelService.getVectorSize();
        const dbPath = this.settingsService.get().dbPath;
        // await this.noteChunkRepository.init(vectorSize, dbPath);

        if (firstTime) {
            await this.noteChunkRepository.init(vectorSize, dbPath, true);
            const count = await this.noteChunkRepository.count();
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
        } else {
            await this.noteChunkRepository.init(vectorSize, dbPath, false);
            this.noteChangeQueue.enqueueAllNotes();
        }

        this.noteIndexingService.startLoop();
    }

    // Handle reindexing of notes
    async reindexNotes(): Promise<void> {
        await this.init(this.settingsService.get().modelId, false, false);
    }

    async changeModel(modelId: string): Promise<void> {
        await this.init(modelId, false, true);
    }

    async closeStore() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }

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
