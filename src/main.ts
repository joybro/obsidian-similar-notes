import log from "loglevel";
import { Plugin } from "obsidian";
import { LeafViewCoordinator } from "./application/LeafViewCoordinator";
import { NoteIndexingService } from "./application/NoteIndexingService";
import { PersistenceOrchestrator } from "./application/PersistenceOrchestrator";
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
import { OramaNoteChunkRepository } from "./infrastructure/OramaNoteChunkRepository";
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
    private persistenceOrchestrator: PersistenceOrchestrator;
    private mTimeStore: MTimeStore;
    private statusBarView: StatusBarView;

    async onload() {
        log.setDefaultLevel(log.levels.DEBUG);
        log.info("Loading Similar Notes plugin");

        this.settingsService = new SettingsService(this);
        await this.settingsService.load();

        this.noteRepository = new VaultNoteRepository(this.app);

        // Initialize model service
        try {
            this.modelService = new EmbeddingService();
            await this.modelService.loadModel(
                this.settingsService.get().modelId
            );

            log.info("Model service initialized successfully");
        } catch (error) {
            log.error("Failed to initialize model service:", error);
        }

        this.noteChunkRepository = new OramaNoteChunkRepository(this.app.vault);

        this.mTimeStore = new MTimeStore(this.app.vault, this.settingsService);

        this.persistenceOrchestrator = new PersistenceOrchestrator(
            this.noteChunkRepository,
            this.mTimeStore,
            this.settingsService
        );

        await this.persistenceOrchestrator.initializeStore(
            this.modelService.getVectorSize()
        );

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
                this.settingsService
            );

            this.statusBarView = new StatusBarView(
                this,
                this.noteIndexingService.getNoteChangeCount$(),
                this.modelService.getModelBusy$()
            );

            this.noteIndexingService.startLoop();
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

        this.persistenceOrchestrator.closeStore();
    }

    // Handle reindexing of notes
    async reindexNotes(): Promise<void> {
        this.noteChangeQueue.enqueueAllNotes();
    }
}
