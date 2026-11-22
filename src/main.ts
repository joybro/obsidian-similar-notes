import log from "loglevel";
import { isNoteExcluded } from "@/utils/noteExclusion";
import { Notice, Plugin } from "obsidian";
import { OramaNoteChunkRepository } from "./adapter/orama/OramaNoteChunkRepository";
import { LeafViewCoordinator } from "./application/LeafViewCoordinator";
import { NoteIndexingService } from "./application/NoteIndexingService";
import { SettingsService } from "./application/SettingsService";
import { ModelLoadGate } from "./application/ModelLoadGate";
import { migrateDataFile } from "./utils/migrateDataFile";
import { SimilarNoteCoordinator } from "./application/SimilarNoteCoordinator";
import type { Command } from "./commands";
import {
    ExportActiveNoteSimilarNotesCommand,
    ReindexAllNotesCommand,
    RetryErroredNotesCommand,
    SemanticSearchCommand,
    ShowSimilarNotesCommand,
    ToggleInDocumentViewCommand,
} from "./commands";
import { HOVER_LINK_SOURCE_ID } from "./components/hoverLinkPreview";
import { SemanticLinkSuggest } from "./components/SemanticLinkSuggest";
import { SimilarNotesSettingTab } from "./components/SimilarNotesSettingTab";
import { SimilarNotesSidebarView } from "./components/SimilarNotesSidebarView";
import { StatusBarView } from "./components/StatusBarView";
import { VIEW_TYPE_SIMILAR_NOTES_SIDEBAR } from "./constants/viewTypes";
import { registerEditorDropHandler } from "./editor/registerEditorDropHandler";
import type { NoteChunkRepository } from "./domain/repository/NoteChunkRepository";
import type { NoteRepository } from "./domain/repository/NoteRepository";
import { EmbeddingService } from "./domain/service/EmbeddingService";
import type { NoteChunkingService } from "./domain/service/NoteChunkingService";
import { SimilarNoteFinder } from "./domain/service/SimilarNoteFinder";
import { TextSearchService } from "./domain/service/TextSearchService";
import { ErroredNoteStore } from "./infrastructure/ErroredNoteStore";
import { IndexedNoteMTimeStore } from "./infrastructure/IndexedNoteMTimeStore";
import { LangchainNoteChunkingService } from "./infrastructure/LangchainNoteChunkingService";
import { VaultNoteRepository } from "./infrastructure/VaultNoteRepository";
import { needsReindexForUpgrade } from "./lifecycle/versionUpgrade";
import { NoteChangeQueue } from "./infrastructure/noteChangeQueue";
import { logRejection } from "@/utils/logRejection";

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
    private textSearchService: TextSearchService;
    private similarNoteCoordinator: SimilarNoteCoordinator;
    private noteIndexingService: NoteIndexingService;
    private indexedNotesMTimeStore: IndexedNoteMTimeStore;
    private erroredNoteStore: ErroredNoteStore;
    private statusBarView: StatusBarView;
    private settingTab: SimilarNotesSettingTab;
    private commands: Command[] = [];
    // Set once the sidebar view type is registered (in initializeServices). The
    // ribbon icon is registered earlier in onload, so this guards early clicks.
    private sidebarViewRegistered = false;
    private modelLoadGate: ModelLoadGate;

    async onload() {
        log.setDefaultLevel(log.levels.ERROR);
        log.info("Loading Similar Notes plugin");

        // Only initialize settings during onload
        this.settingsService = new SettingsService(this);
        await this.settingsService.load();

        // Check if plugin version has changed and trigger reindex if needed
        const settings = this.settingsService.get();
        const currentVersion = this.manifest.version;
        const needsReindex = needsReindexForUpgrade(settings.lastPluginVersion, currentVersion);

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

        // Register the ribbon icon early (before layout restore) so Obsidian applies
        // the user's "hide from ribbon" choice; late registration misses it (#50).
        this.addRibbonIcon("telescope", "Open Similar Notes", () => {
            logRejection(this.activateSimilarNotesView(), "open Similar Notes view");
        });

        // Defer all other initialization to onLayoutReady
        this.app.workspace.onLayoutReady(() => this.initializeServices(needsReindex));
    }

    private async getPluginDataDir(): Promise<string> {
        const pluginDataDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;

        // Ensure the plugin directory exists
        if (!(await this.app.vault.adapter.exists(pluginDataDir))) {
            await this.app.vault.adapter.mkdir(pluginDataDir);
        }

        return pluginDataDir;
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
                logRejection(this.leafViewCoordinator?.onLayoutChange(), "handle layout change");
            })
        );

        this.registerEvent(
            this.app.workspace.on("active-leaf-change", async (leaf) => {
                logRejection(this.leafViewCoordinator?.onActiveLeafChange(leaf), "handle active leaf change");
            })
        );
    }

    private async initializeServices(needsReindex = false) {
        // Create core repositories
        this.noteRepository = new VaultNoteRepository(this.app);
        this.indexedNotesMTimeStore = new IndexedNoteMTimeStore();
        this.erroredNoteStore = new ErroredNoteStore();

        // Now that mTimeStore is initialized, set it in the settings tab
        this.settingTab.setMTimeStore(this.indexedNotesMTimeStore);
        this.settingTab.setErroredStore(this.erroredNoteStore);

        // Create services in proper dependency order
        this.modelService = new EmbeddingService(this.settingsService);
        this.noteChunkRepository = new OramaNoteChunkRepository(this.app.vault);

        // Set the model service in the settings tab
        this.settingTab.setModelService(this.modelService);

        // Initialize IndexedNoteMTimeStore with vault ID
        const vaultId = this.app.appId;
        await this.indexedNotesMTimeStore.init(vaultId);
        await this.erroredNoteStore.init(vaultId);

        // Initialize dependent services
        this.noteChunkingService = new LangchainNoteChunkingService(
            this.modelService
        );

        this.similarNoteFinder = new SimilarNoteFinder(
            this.noteChunkRepository,
            this.noteChunkingService,
            this.modelService
        );

        const isExcluded = (path: string): boolean =>
            isNoteExcluded(
                path,
                {
                    excludeFolderPatterns:
                        this.settingsService.get().excludeFolderPatterns,
                    excludeFrontmatterRules:
                        this.settingsService.get().excludeFrontmatterRules ?? [],
                },
                (p) => {
                    const f = this.app.vault.getFileByPath(p);
                    return f
                        ? this.app.metadataCache.getFileCache(f)?.frontmatter
                        : undefined;
                }
            );

        this.textSearchService = new TextSearchService(
            this.noteChunkRepository,
            this.modelService,
            isExcluded
        );

        this.similarNoteCoordinator = new SimilarNoteCoordinator(
            this.app.vault,
            this.noteRepository,
            this.similarNoteFinder,
            this.settingsService,
            isExcluded
        );

        this.leafViewCoordinator = new LeafViewCoordinator(
            this.app,
            this.similarNoteCoordinator,
            this.settingsService
        );

        // Initialize file change queue
        this.noteChangeQueue = new NoteChangeQueue(
            this.app.vault,
            this.app.metadataCache,
            this.indexedNotesMTimeStore,
            this.settingsService,
            this.erroredNoteStore
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
            this.app,
            this.erroredNoteStore
        );

        // noteIndexingService is now initialized
        this.register(
            (() => {
                const sub = this.similarNoteCoordinator.watchPendingIndexCount(
                    this.noteIndexingService.getNoteChangeCount$(),
                    (path) => this.noteChangeQueue.getQueuedCountFor(path)
                );
                return () => sub.unsubscribe();
            })()
        );

        this.modelLoadGate = new ModelLoadGate(this.similarNoteCoordinator);
        const progressSub = this.modelLoadGate.watch(this.modelService.getDownloadProgress$());
        this.register(() => progressSub.unsubscribe());

        this.statusBarView = new StatusBarView({
            plugin: this,
            app: this.app,
            noteChangeCount$: this.noteIndexingService.getNoteChangeCount$(),
            // Filtered by the gate: reading a model from disk also reports
            // progress and must not show as a download.
            downloadProgress$: this.modelLoadGate.getShownDownloadProgress$(),
            modelError$: this.modelService.getModelError$(),
            indexedNotesMTimeStore: this.indexedNotesMTimeStore,
            erroredNoteStore: this.erroredNoteStore,
            noteChunkRepository: this.noteChunkRepository,
            modelService: this.modelService,
            isExcluded,
            onRetry: () => {
                logRejection(this.init(this.settingsService.get().modelId, true, false), "retry model load");
            },
            onOpenSettings: () => {
                this.app.setting.open();
                this.app.setting.openTabById("similar-notes");
            },
        });

        // Register sidebar view
        this.registerView(
            VIEW_TYPE_SIMILAR_NOTES_SIDEBAR,
            (leaf) =>
                new SimilarNotesSidebarView(
                    leaf,
                    this.similarNoteCoordinator.getNoteBottomViewModelObservable(),
                    (onDismissed) => SemanticSearchCommand.openModal(this.app, this.textSearchService, this.settingsService, { onDismissed })
                )
        );
        this.sidebarViewRegistered = true;

        // Register commands
        this.registerCommands();

        // Let Page Preview show note previews for our hover-link events
        // (bottom pane, sidebar, link suggester), with a per-source Mod-key
        // toggle in Page Preview settings.
        this.registerHoverLinkSource(HOVER_LINK_SOURCE_ID, {
            display: "Similar Notes",
            defaultMod: true,
        });

        // Register the semantic link suggester (standalone trigger; default ";;")
        this.registerEditorSuggest(
            new SemanticLinkSuggest(
                this.app,
                this.textSearchService,
                this.settingsService
            )
        );

        // Register editor-drop event handler
        registerEditorDropHandler(this);

        // Complete initialization
        // If needsReindex is true, trigger a reindex to migrate from JSON to IndexedDB
        // Notes restored with the workspace fired file-open and
        // active-leaf-change before these services existed, so nothing
        // rendered for them (obsidian-host-integration-spec section 4).
        // Render them now on the waiting line; the gate searches for the
        // active note once the model and the index are usable.
        this.modelLoadGate.begin();
        logRejection(this.leafViewCoordinator.renderNotesOpenAtStartup(), "render notes at startup");

        await this.init(this.settingsService.get().modelId, true, needsReindex);
    }

    private registerCommands() {
        // Initialize commands
        this.commands = [
            new ShowSimilarNotesCommand(this),
            new ToggleInDocumentViewCommand(this.settingsService),
            new ReindexAllNotesCommand(this),
            new RetryErroredNotesCommand(this),
            new SemanticSearchCommand(
                this.app,
                this.textSearchService,
                this.settingsService
            ),
            new ExportActiveNoteSimilarNotesCommand(this.app, this.similarNoteCoordinator, this.manifest.id),
        ];

        // Register each command
        this.commands.forEach((command) => {
            command.register(this);
        });
    }

    async activateSimilarNotesView() {
        // The ribbon icon exists from onload, but the sidebar view type is only
        // registered later in initializeServices. Guard clicks during the brief
        // startup window before initialization completes.
        if (!this.sidebarViewRegistered) {
            new Notice("Similar Notes is still loading…");
            return;
        }

        const existing = this.app.workspace.getLeavesOfType(
            VIEW_TYPE_SIMILAR_NOTES_SIDEBAR
        );

        if (existing.length > 0) {
            // If sidebar is already open, focus it
            logRejection(this.app.workspace.revealLeaf(existing[0]), "reveal Similar Notes view");
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

    onunload() {
        // Sidebar leaves are not detached: Obsidian restores them in place
        // when the plugin loads again (plugin guidelines).
        this.statusBarView.dispose();
        this.noteIndexingService.stopLoop();
        logRejection(this.leafViewCoordinator.onUnload(), "unload leaf views");
        logRejection(this.disposeServices(), "dispose services");
    }

    // Obsidian does not await onunload; the steps below keep their order here.
    private async disposeServices(): Promise<void> {
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

        if (this.noteChunkRepository?.setLogLevel) {
            this.noteChunkRepository.setLogLevel(level);
        }
    }

    async init(
        modelId: string,
        firstTime: boolean,
        newModel: boolean
    ): Promise<void> {
        try {
            await this.loadModelAndIndex(firstTime, newModel);
        } finally {
            // Search for a note opened meanwhile, also after a failure, so
            // the panel never stays on the waiting line.
            this.modelLoadGate.end();
        }
    }

    private async loadModelAndIndex(
        firstTime: boolean,
        newModel: boolean
    ): Promise<void> {
        this.noteIndexingService.stopLoop();

        try {
            if (firstTime || newModel) {
                // Notes opened from here on wait for the model instead of
                // failing against a provider that is not loaded yet.
                this.modelLoadGate.begin();
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

                logRejection(this.noteChunkingService.init(), "init chunking service");
            }
        } catch (error) {
            log.error("Failed to initialize model service:", error);
            return;
        }

        const vectorSize = this.modelService.getVectorSize();
        const pluginDataDir = await this.getPluginDataDir();
        const dbPath = `${pluginDataDir}/${dbFileName}`;

        // Get vault ID for IndexedDB isolation
        const vaultId = this.app.appId;

        // Migrate existing database from old location to new location
        const oldDbPath = `${this.app.vault.configDir}/${dbFileName}`;
        await migrateDataFile(this.app.vault.adapter, oldDbPath, dbPath);

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
            logRejection(this.noteChangeQueue.enqueueAllNotes(), "queue all notes for reindex");
        }

        // Pass NoteChunkRepository to the settings tab after it's initialized
        await this.settingTab.setNoteChunkRepository(this.noteChunkRepository);

        if (firstTime) {
            // Notes indexed before title rows existed get them now
            // (title-vector spec "Backfill"). A reindex writes them anyway.
            await this.noteIndexingService.enqueueTitleBackfill();
        }

        // Start the noteIndexingService loop
        this.noteIndexingService.startLoop();
    }

    // Re-queue all terminally-errored notes for another attempt
    async retryErroredNotes(): Promise<void> {
        await this.noteChangeQueue.retryErrored();
    }

    // Handle reindexing of notes
    async reindexNotes(): Promise<void> {
        // Clear the mTime store to ensure all notes are reindexed
        await this.indexedNotesMTimeStore.clear();
        await this.erroredNoteStore.clear();
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
        await this.erroredNoteStore.clear();
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

        this.modelLoadGate.begin();
        try {
            // Reload the model with current settings
            await this.modelService.switchProvider(settings);
        } catch (error) {
            log.error("Failed to reload model:", error);
            // Error state is handled by modelError$ observable in StatusBarView
        } finally {
            // Restart the indexing service whether the model load succeeded or failed
            // This ensures the service doesn't remain stopped
            this.noteIndexingService.startLoop();
            this.modelLoadGate.end();
        }
    }
}
