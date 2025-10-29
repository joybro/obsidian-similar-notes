import log from "loglevel";
import { Plugin } from "obsidian";
import { OramaNoteChunkRepository } from "./adapter/orama/OramaNoteChunkRepository";
import { LeafViewCoordinator } from "./application/LeafViewCoordinator";
import { NoteIndexingService } from "./application/NoteIndexingService";
import { SettingsService } from "./application/SettingsService";
import { SimilarNoteCoordinator } from "./application/SimilarNoteCoordinator";
import type { Command } from "./commands";
import {
    ReindexAllNotesCommand,
    ShowSimilarNotesCommand,
    ToggleInDocumentViewCommand,
} from "./commands";
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

export default class MainPlugin extends Plugin {
    private leafViewCoordinator: LeafViewCoordinator;
    private settingsService: SettingsService;
    private noteChunkRepository: NoteChunkRepository;
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

        // Check if plugin version has changed and trigger reindex if needed
        const settings = this.settingsService.get();
        const currentVersion = this.manifest.version;
        const needsReindex = this.checkVersionUpgrade(settings.lastPluginVersion, currentVersion);

        if (needsReindex) {
            log.info(`Plugin upgraded from ${settings.lastPluginVersion || 'unknown'} to ${currentVersion}. Will trigger reindex.`);
            // Update version in settings
            await this.settingsService.update({ lastPluginVersion: currentVersion });
        }

        // Add settings tab (IndexedNoteMTimeStore will be set later)
        this.settingTab = new SimilarNotesSettingTab(
            this,
            this.settingsService
        );
        this.addSettingTab(this.settingTab);

        // Register essential events
        this.registerEvents();

        // Defer all other initialization to onLayoutReady
        this.app.workspace.onLayoutReady(() => this.initializeServices(needsReindex));
    }

    /**
     * Check if plugin version has changed and determine if reindex is needed
     * Returns true if upgrading from version <= 0.10.0 (includes 0.10.0 due to migration issues)
     */
    private checkVersionUpgrade(lastVersion: string | undefined, currentVersion: string): boolean {
        // If no last version recorded, this is either a fresh install or upgrade from pre-0.10.0
        if (!lastVersion) {
            log.info("No last version recorded - will trigger reindex for IndexedDB migration");
            return true;
        }

        // Parse versions
        const parseVersion = (v: string): number[] => {
            return v.split('.').map(n => parseInt(n, 10) || 0);
        };

        const last = parseVersion(lastVersion);

        // Check if upgrading from <= 0.10.0 (including 0.10.0 which had migration issues)
        if (last[0] === 0 && last[1] === 10 && last[2] === 0) {
            log.info(`Upgrading from ${lastVersion} to ${currentVersion} - reindex needed due to 0.10.0 migration issues`);
            return true;
        }

        if (last[0] === 0 && last[1] < 10) {
            log.info(`Upgrading from ${lastVersion} to ${currentVersion} - reindex needed for IndexedDB migration`);
            return true;
        }

        return false;
    }

    private async getPluginDataDir(): Promise<string> {
        const pluginDataDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;

        // Ensure the plugin directory exists
        if (!(await this.app.vault.adapter.exists(pluginDataDir))) {
            await this.app.vault.adapter.mkdir(pluginDataDir);
        }

        return pluginDataDir;
    }

    private async migrateDataFiles(
        oldPath: string,
        newPath: string
    ): Promise<void> {
        try {
            if (
                (await this.app.vault.adapter.exists(oldPath)) &&
                !(await this.app.vault.adapter.exists(newPath))
            ) {
                log.info(`Migrating file from ${oldPath} to ${newPath}`);
                const data = await this.app.vault.adapter.read(oldPath);
                await this.app.vault.adapter.write(newPath, data);
                await this.app.vault.adapter.remove(oldPath);
                log.info(`Successfully migrated file to plugin folder`);
            }
        } catch (error) {
            log.error(
                `Failed to migrate file from ${oldPath} to ${newPath}:`,
                error
            );
        }
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

    private async initializeServices(needsReindex: boolean = false) {
        // Create core repositories
        this.noteRepository = new VaultNoteRepository(this.app);
        this.indexedNotesMTimeStore = new IndexedNoteMTimeStore();

        // Now that mTimeStore is initialized, set it in the settings tab
        this.settingTab.setMTimeStore(this.indexedNotesMTimeStore);

        // Create services in proper dependency order
        this.modelService = new EmbeddingService(this.settingsService);
        this.noteChunkRepository = new OramaNoteChunkRepository(this.app.vault);

        // Set the model service in the settings tab
        this.settingTab.setModelService(this.modelService);

        // Initialize IndexedNoteMTimeStore with vault ID
        // @ts-ignore - appId exists at runtime but not in type definitions
        const vaultId = this.app.appId as string;
        await this.indexedNotesMTimeStore.init(vaultId);

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
            this.indexedNotesMTimeStore,
            this.settingsService
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
        // If needsReindex is true, trigger a reindex to migrate from JSON to IndexedDB
        await this.init(this.settingsService.get().modelId, true, needsReindex);
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
        const pluginDataDir = await this.getPluginDataDir();
        const dbPath = `${pluginDataDir}/${dbFileName}`;

        // Get vault ID for IndexedDB isolation
        // @ts-ignore - appId exists at runtime but not in type definitions
        const vaultId = this.app.appId as string;

        // Migrate existing database from old location to new location
        const oldDbPath = `${this.app.vault.configDir}/${dbFileName}`;
        await this.migrateDataFiles(oldDbPath, dbPath);

        if (firstTime) {
            await this.noteChunkRepository.init(
                vectorSize,
                vaultId,
                true // loadExistingData
            );
        } else {
            await this.noteChunkRepository.init(
                vectorSize,
                vaultId,
                false // loadExistingData - reindex from scratch
            );
            this.noteChangeQueue.enqueueAllNotes();
        }

        // Pass NoteChunkRepository to the settings tab after it's initialized
        await this.settingTab.setNoteChunkRepository(this.noteChunkRepository);

        // Start the noteIndexingService loop
        this.noteIndexingService.startLoop();
    }

    // Handle reindexing of notes
    async reindexNotes(): Promise<void> {
        // Clear the mTime store to ensure all notes are reindexed
        await this.indexedNotesMTimeStore.clear();
        await this.init(this.settingsService.get().modelId, false, false);
    }

    // Apply current exclusion patterns to synchronize index with current patterns
    async applyExclusionPatterns(): Promise<{
        removed: number;
        added: number;
    }> {
        return await this.noteChangeQueue.applyExclusionPatterns();
    }

    // Preview how many files would be changed by current patterns
    previewExclusionApplication(): { removed: number; added: number } {
        return this.noteChangeQueue.previewExclusionApplication();
    }

    async changeModel(modelId: string): Promise<void> {
        // modelId parameter is kept for backward compatibility but not used
        // The actual model info is taken from settings
        // Clear the mTime store to ensure all notes are reindexed
        await this.indexedNotesMTimeStore.clear();
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
}
