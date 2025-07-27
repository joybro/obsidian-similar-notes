import log from "loglevel";
import { Plugin } from "obsidian";
import { OramaNoteChunkRepository } from "./adapter/orama/OramaNoteChunkRepository";
import { LeafViewCoordinator } from "./application/LeafViewCoordinator";
import { NoteIndexingService } from "./application/NoteIndexingService";
import { SettingsService } from "./application/SettingsService";
import { SimilarNoteCoordinator } from "./application/SimilarNoteCoordinator";
import type { Command } from "./commands";
import { ShowSimilarNotesCommand, ToggleInDocumentViewCommand, ReindexAllNotesCommand } from "./commands";
import { SimilarNotesSettingTab } from "./components/SimilarNotesSettingTab";
import { SimilarNotesSidebarView } from "./components/SimilarNotesSidebarView";
import { StatusBarView } from "./components/StatusBarView";
import { VIEW_TYPE_SIMILAR_NOTES_SIDEBAR } from "./constants/viewTypes";
import type { NoteChunkRepository } from "./domain/repository/NoteChunkRepository";
import type { NoteRepository } from "./domain/repository/NoteRepository";
import { EmbeddingService } from "./domain/service/EmbeddingService";
import type { NoteChunkingService } from "./domain/service/NoteChunkingService";
import { SimilarNoteFinder } from "./domain/service/SimilarNoteFinder";
import { IndexedNoteMTimeStore } from "./infrastructure/IndexedNoteMTimeStore";
import { LangchainNoteChunkingService } from "./infrastructure/LangchainNoteChunkingService";
import { VaultNoteRepository } from "./infrastructure/VaultNoteRepository";
import { NoteChangeQueue } from "./services/noteChangeQueue";

const dbFileName = "similar-notes.json";
const fileMtimeFileName = "similar-notes-file-mtimes.json";

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
    private indexedNotesMTimeStore: IndexedNoteMTimeStore;
    private statusBarView: StatusBarView;
    private settingTab: SimilarNotesSettingTab;
    private commands: Command[] = [];

    async onload() {
        log.setDefaultLevel(log.levels.ERROR);
        log.info("Loading Similar Notes plugin");

        // Only initialize settings during onload
        this.settingsService = new SettingsService(this);
        await this.settingsService.load();

        // Add settings tab (IndexedNoteMTimeStore will be set later)
        this.settingTab = new SimilarNotesSettingTab(
            this,
            this.settingsService
        );
        this.addSettingTab(this.settingTab);

        // Register essential events
        this.registerEvents();

        // Defer all other initialization to onLayoutReady
        this.app.workspace.onLayoutReady(() => this.initializeServices());
    }

    private registerEvents() {
        // Register events that need to be available early
        this.registerEvent(
            this.app.workspace.on("file-open", async (file) => {
                // Use optional chaining as the coordinator may not be initialized yet
                await this.similarNoteCoordinator?.onFileOpen(file);
            })
        );

        this.registerEvent(
            this.app.workspace.on("layout-change", async () => {
                this.leafViewCoordinator?.onLayoutChange();
            })
        );

        this.registerEvent(
            this.app.workspace.on("active-leaf-change", async (leaf) => {
                this.leafViewCoordinator?.onActiveLeafChange(leaf);
            })
        );
    }

    private async initializeServices() {
        const fileMtimePath =
            this.app.vault.configDir + "/" + fileMtimeFileName;

        // Create core repositories
        this.noteRepository = new VaultNoteRepository(this.app);
        this.indexedNotesMTimeStore = new IndexedNoteMTimeStore(
            this.app.vault,
            fileMtimePath
        );

        // Now that mTimeStore is initialized, set it in the settings tab
        this.settingTab.setMTimeStore(this.indexedNotesMTimeStore);

        // Create services in proper dependency order
        this.modelService = new EmbeddingService();
        this.noteChunkRepository = new OramaNoteChunkRepository(this.app.vault);

        // Set the model service in the settings tab
        this.settingTab.setModelService(this.modelService);

        // Restore persisted data
        await this.indexedNotesMTimeStore.restore();

        // Initialize dependent services
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
            this.similarNoteCoordinator,
            this.settingsService
        );

        // Initialize file change queue
        this.noteChangeQueue = new NoteChangeQueue(
            this.app.vault,
            this.indexedNotesMTimeStore
        );
        await this.noteChangeQueue.initialize();

        this.noteIndexingService = new NoteIndexingService(
            this.noteRepository,
            this.noteChunkRepository,
            this.noteChangeQueue,
            this.noteChunkingService,
            this.modelService,
            this.similarNoteCoordinator,
            this.settingsService,
            this.app
        );

        // noteIndexingService is now initialized

        this.statusBarView = new StatusBarView(
            this,
            this.noteIndexingService.getNoteChangeCount$(),
            this.modelService.getModelBusy$(),
            this.modelService.getDownloadProgress$(),
            this.modelService.getModelError$()
        );

        // Register sidebar view
        this.registerView(
            VIEW_TYPE_SIMILAR_NOTES_SIDEBAR,
            (leaf) =>
                new SimilarNotesSidebarView(
                    leaf,
                    this.similarNoteCoordinator.getNoteBottomViewModelObservable()
                )
        );

        // Add ribbon icon
        this.addRibbonIcon("files", "Open Similar Notes", () => {
            this.activateSimilarNotesView();
        });

        // Register commands
        this.registerCommands();

        // Complete initialization
        await this.init(this.settingsService.get().modelId, true, false);
    }

    private registerCommands() {
        // Initialize commands
        this.commands = [
            new ShowSimilarNotesCommand(this),
            new ToggleInDocumentViewCommand(this.settingsService),
            new ReindexAllNotesCommand(this),
        ];

        // Register each command
        this.commands.forEach((command) => {
            command.register(this);
        });
    }

    async activateSimilarNotesView() {
        const existing = this.app.workspace.getLeavesOfType(
            VIEW_TYPE_SIMILAR_NOTES_SIDEBAR
        );

        if (existing.length > 0) {
            // If sidebar is already open, focus it
            this.app.workspace.revealLeaf(existing[0]);
        } else {
            // Open in right sidebar
            const leaf = this.app.workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({
                    type: VIEW_TYPE_SIMILAR_NOTES_SIDEBAR,
                    active: true,
                });
            }
        }
    }

    async onunload() {
        // Clean up sidebar views
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_SIMILAR_NOTES_SIDEBAR);

        this.statusBarView.dispose();
        this.noteIndexingService.stopLoop();
        this.leafViewCoordinator.onUnload();

        // Clear auto-save interval
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }

        // Persist and close database connections
        await this.closeStore();

        // Explicitly dispose Orama worker
        if (this.noteChunkRepository) {
            // Call our new dispose method on the repository
            log.info("Disposing note chunk repository worker");
            await this.noteChunkRepository.dispose();
        }

        this.noteChangeQueue.cleanup();

        // Dispose of model service - do this last as it's the most memory intensive
        if (this.modelService) {
            log.info("Disposing model service");
            this.modelService.dispose();
        }

        log.info("Similar Notes plugin unloaded");
    }

    public setLogLevel(level: log.LogLevelDesc): void {
        log.setLevel(level);
        log.info(`Main thread log level set to: ${log.getLevel()}`);

        if (this.modelService) {
            this.modelService.setLogLevel(level);
        }

        if (this.noteChunkRepository) {
            const repository = this.noteChunkRepository as any;
            if (typeof repository.setLogLevel === "function") {
                repository.setLogLevel(level);
            }
        }
    }

    async init(
        modelId: string,
        firstTime: boolean,
        newModel: boolean
    ): Promise<void> {
        this.noteIndexingService.stopLoop();

        try {
            if (firstTime || newModel) {
                // Get settings and switch provider
                const settings = this.settingsService.get();

                // Switch to appropriate provider based on settings
                await this.modelService.switchProvider(settings);
                log.info(
                    "Model service initialized successfully with provider:",
                    settings.modelProvider,
                    "and model:",
                    settings.modelProvider === "builtin"
                        ? settings.modelId
                        : settings.ollamaModel
                );

                this.noteChunkingService.init();
            }
        } catch (error) {
            log.error("Failed to initialize model service:", error);
            return;
        }

        const vectorSize = this.modelService.getVectorSize();
        const dbPath = this.app.vault.configDir + "/" + dbFileName;

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

        // Start the noteIndexingService loop
        this.noteIndexingService.startLoop();
    }

    // Handle reindexing of notes
    async reindexNotes(): Promise<void> {
        // Clear the mTime store to ensure all notes are reindexed
        this.indexedNotesMTimeStore.clear();
        await this.init(this.settingsService.get().modelId, false, false);
    }

    async changeModel(modelId: string): Promise<void> {
        // modelId parameter is kept for backward compatibility but not used
        // The actual model info is taken from settings
        // Clear the mTime store to ensure all notes are reindexed
        this.indexedNotesMTimeStore.clear();
        await this.init(modelId, false, true);
    }

    /**
     * Reload the current model with updated GPU settings
     * This does not trigger reindexing as it only changes how the model runs
     */
    async reloadModel(): Promise<void> {
        // Stop the indexing service to prevent any operations during model reload
        this.noteIndexingService.stopLoop();

        // Get current settings
        const settings = this.settingsService.get();

        try {
            // Reload the model with current settings
            await this.modelService.switchProvider(settings);
            this.statusBarView.setStatus("ready");
        } catch (error) {
            log.error("Failed to reload model:", error);
            this.statusBarView.setStatus("error");
        } finally {
            // Restart the indexing service whether the model load succeeded or failed
            // This ensures the service doesn't remain stopped
            this.noteIndexingService.startLoop();
        }
    }

    async closeStore() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }

        await this.noteChunkRepository.persist();
        await this.indexedNotesMTimeStore.persist();
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
                await this.indexedNotesMTimeStore.persist();
                log.info("Auto-saved databases");
            } catch (e) {
                log.error("Failed to auto-save database:", e);
            }
        }, intervalMs);
    }
}
