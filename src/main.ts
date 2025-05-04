import log from "loglevel";
import { Plugin } from "obsidian";
import { LeafViewCoordinator } from "./application/LeafViewCoordinator";
import { SimilarNoteCoordinator } from "./application/SimilarNoteCoordinator";
import { SimilarNotesSettingTab } from "./components/SimilarNotesSettingTab";
import type { NoteChunkRepository } from "./domain/repository/NoteChunkRepository";
import type { NoteRepository } from "./domain/repository/NoteRepository";
import { EmbeddingService } from "./domain/service/EmbeddingService";
import type { NoteChunkingService } from "./domain/service/NoteChunkingService";
import { SimilarNoteFinder } from "./domain/service/SimilarNoteFinder";
import { LangchainNoteChunkingService } from "./infrastructure/LangchainNoteChunkingService";
import { OramaNoteChunkRepository } from "./infrastructure/OramaNoteChunkRepository";
import { VaultNoteRepository } from "./infrastructure/VaultNoteRepository";
import { NoteChangeQueue } from "./services/noteChangeQueue";
interface SimilarNotesSettings {
    dbPath: string;
    autoSaveInterval: number; // in minutes
    fileMtimePath: string;
    modelId: string; // The model ID to use for embeddings
}

const DEFAULT_SETTINGS: SimilarNotesSettings = {
    dbPath: ".obsidian/similar-notes.json",
    autoSaveInterval: 5,
    fileMtimePath: ".obsidian/similar-notes-file-mtimes.json",
    modelId: "sentence-transformers/all-MiniLM-L6-v2",
};

export default class MainPlugin extends Plugin {
    private leafViewCoordinator: LeafViewCoordinator;
    private settings: SimilarNotesSettings;
    private noteChunkRepository: NoteChunkRepository;
    private autoSaveInterval: NodeJS.Timeout;
    private fileChangeQueue: NoteChangeQueue;
    private modelService: EmbeddingService;
    private fileChangeLoop: () => Promise<void>;
    private fileChangeLoopTimer: NodeJS.Timeout;
    private noteRepository: NoteRepository;
    private noteChunkingService: NoteChunkingService;
    private similarNoteFinder: SimilarNoteFinder;
    private similarNoteCoordinator: SimilarNoteCoordinator;

    async onload() {
        log.setDefaultLevel(log.levels.INFO);
        log.info("Loading Similar Notes plugin");

        this.noteRepository = new VaultNoteRepository(this.app.vault);

        // Load settings
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );

        // Initialize model service
        try {
            this.modelService = new EmbeddingService();
            await this.modelService.loadModel(this.settings.modelId);

            log.info("Model service initialized successfully");
        } catch (error) {
            log.error("Failed to initialize model service:", error);
        }

        this.noteChunkingService = new LangchainNoteChunkingService(
            this.modelService
        );

        // Initialize store
        await this.initializeStore(this.modelService.getVectorSize());

        this.similarNoteFinder = new SimilarNoteFinder(
            this.noteChunkRepository,
            this.noteChunkingService,
            this.modelService
        );

        this.similarNoteCoordinator = new SimilarNoteCoordinator(
            this.app.vault,
            this.noteRepository,
            this.similarNoteFinder
        );

        this.leafViewCoordinator = new LeafViewCoordinator(
            this.app,
            this.similarNoteCoordinator
        );

        // Setup auto-save interval
        this.setupAutoSave();

        // Add settings tab
        this.addSettingTab(new SimilarNotesSettingTab(this.app, this));

        // Register event when current open file changes
        const fileOpenRef = this.app.workspace.on("file-open", async (file) => {
            this.leafViewCoordinator.onFileOpen(file);
            this.similarNoteCoordinator.onFileOpen(file);
        });
        this.registerEvent(fileOpenRef);

        const layoutChangeRef = this.app.workspace.on(
            "layout-change",
            async () => {
                this.leafViewCoordinator.onLayoutChange();
            }
        );
        this.registerEvent(layoutChangeRef);

        // Initialize file change queue
        this.app.workspace.onLayoutReady(async () => {
            this.fileChangeQueue = new NoteChangeQueue({
                vault: this.app.vault,
            });
            const queueMetadata = await this.loadQueueMetadataFromDisk();
            await this.fileChangeQueue.initialize(queueMetadata);

            const statusBarItem = this.addStatusBarItem();

            const processDeletedNote = async (path: string) => {
                await this.noteChunkRepository.removeByPath(path);
            };

            const processUpdatedNote = async (path: string) => {
                const note = await this.noteRepository.findByPath(path);
                if (!note || !note.content) {
                    return;
                }

                const splitted = await this.noteChunkingService.split(note);
                const noteChunks = await Promise.all(
                    splitted.map(async (chunk) =>
                        chunk.withEmbedding(
                            await this.modelService.embedText(chunk.content)
                        )
                    )
                );

                log.info("chunks", noteChunks);

                await this.noteChunkRepository.removeByPath(note.path);
                await this.noteChunkRepository.putMulti(noteChunks);

                log.info(
                    "count of chunks in embedding store",
                    this.noteChunkRepository.count()
                );
            };

            this.fileChangeLoop = async () => {
                const count = this.fileChangeQueue.getFileChangeCount();
                if (count > 10) {
                    statusBarItem.setText(`${count} to index`);
                    statusBarItem.show();
                } else {
                    statusBarItem.hide();
                }

                const changes = await this.fileChangeQueue.pollFileChanges(1);
                if (changes.length === 0) {
                    this.fileChangeLoopTimer = setTimeout(
                        this.fileChangeLoop,
                        1000
                    );
                    return;
                }

                const change = changes[0];
                log.info("processing change", change.path);

                if (change.reason === "deleted") {
                    await processDeletedNote(change.path);
                } else {
                    await processUpdatedNote(change.path);
                }

                await this.fileChangeQueue.markNoteChangeProcessed(change);

                this.fileChangeLoop();
            };

            this.fileChangeLoop();
        });
    }

    async onunload() {
        this.leafViewCoordinator.onUnload();

        if (this.fileChangeLoopTimer) {
            clearTimeout(this.fileChangeLoopTimer);
        }

        // Clear auto-save interval
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }

        // Dispose of model service
        if (this.modelService) {
            this.modelService.dispose();
        }

        // Save any pending changes and close store
        if (this.noteChunkRepository) {
            try {
                await this.noteChunkRepository.persist();
            } catch (e) {
                log.error("Error while closing note chunk repository:", e);
            }
        }
        // Cleanup file change queue
        if (this.fileChangeQueue) {
            try {
                await this.saveQueueMetadataToDisk();
                this.fileChangeQueue.cleanup();
            } catch (e) {
                log.error("Error while closing file change queue:", e);
            }
        }
    }

    // Handle reindexing of notes
    async reindexNotes(): Promise<void> {
        this.fileChangeQueue.enqueueAllNotes();
    }

    private async initializeStore(vectorSize: number) {
        try {
            // Create store instance
            this.noteChunkRepository = new OramaNoteChunkRepository(
                this.app.vault,
                vectorSize,
                this.settings.dbPath
            );

            // Try to load existing database
            try {
                await this.noteChunkRepository.restore();
                const count = this.noteChunkRepository.count();
                log.info(
                    "Successfully loaded existing database from",
                    this.settings.dbPath,
                    "with",
                    count,
                    "chunks"
                );
            } catch (e) {
                log.info(
                    "No existing database found at",
                    this.settings.dbPath,
                    "- starting fresh"
                );
            }
        } catch (e) {
            log.error("Failed to initialize store:", e);
            throw e;
        }
    }

    private setupAutoSave() {
        // Clear any existing interval
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }

        // Set up new auto-save interval
        const intervalMs = this.settings.autoSaveInterval * 60 * 1000;
        this.autoSaveInterval = setInterval(async () => {
            try {
                await this.noteChunkRepository.persist();
                await this.saveQueueMetadataToDisk();
                log.info("Auto-saved databases");
            } catch (e) {
                log.error("Failed to auto-save database:", e);
            }
        }, intervalMs);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // Public methods for settings access
    getSettings(): SimilarNotesSettings {
        return { ...this.settings };
    }

    async updateSettings(
        updates: Partial<SimilarNotesSettings>
    ): Promise<void> {
        this.settings = { ...this.settings, ...updates };
        await this.saveSettings();

        // If auto-save interval changed, update the interval
        if (updates.autoSaveInterval !== undefined) {
            this.setupAutoSave();
        }
    }

    private async saveQueueMetadataToDisk(): Promise<void> {
        const metadata = await this.fileChangeQueue.getMetadata();
        await this.app.vault.adapter.write(
            this.settings.fileMtimePath,
            JSON.stringify(metadata)
        );
    }

    private async loadQueueMetadataFromDisk(): Promise<Record<string, number>> {
        const exist = await this.app.vault.adapter.exists(
            this.settings.fileMtimePath
        );

        if (!exist) {
            return {};
        }
        const content = await this.app.vault.adapter.read(
            this.settings.fileMtimePath
        );
        return JSON.parse(content);
    }
}
