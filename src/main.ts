import log from "loglevel";
import { Plugin } from "obsidian";
import { LeafViewCoordinator } from "./application/LeafViewCoordinator";
import { SettingsService } from "./application/SettingsService";
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

export default class MainPlugin extends Plugin {
    private leafViewCoordinator: LeafViewCoordinator;
    private settingsService: SettingsService;
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
        log.setDefaultLevel(log.levels.DEBUG);
        log.info("Loading Similar Notes plugin");

        this.settingsService = new SettingsService(this, this.setupAutoSave);
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

        this.noteChunkingService = new LangchainNoteChunkingService(
            this.modelService
        );

        // Initialize store
        await this.initializeStore(
            this.modelService.getVectorSize(),
            this.settingsService.get().dbPath
        );

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
        this.setupAutoSave(this.settingsService.get().autoSaveInterval);

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

    private async initializeStore(vectorSize: number, dbPath: string) {
        try {
            // Create store instance
            this.noteChunkRepository = new OramaNoteChunkRepository(
                this.app.vault,
                vectorSize,
                dbPath
            );

            // Try to load existing database
            try {
                await this.noteChunkRepository.restore();
                const count = this.noteChunkRepository.count();
                log.info(
                    "Successfully loaded existing database from",
                    dbPath,
                    "with",
                    count,
                    "chunks"
                );
            } catch (e) {
                log.info(
                    "No existing database found at",
                    dbPath,
                    "- starting fresh"
                );
            }
        } catch (e) {
            log.error("Failed to initialize store:", e);
            throw e;
        }
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
                await this.saveQueueMetadataToDisk();
                log.info("Auto-saved databases");
            } catch (e) {
                log.error("Failed to auto-save database:", e);
            }
        }, intervalMs);
    }

    private async saveQueueMetadataToDisk(): Promise<void> {
        const metadata = await this.fileChangeQueue.getMetadata();
        await this.app.vault.adapter.write(
            this.settingsService.get().fileMtimePath,
            JSON.stringify(metadata)
        );
    }

    private async loadQueueMetadataFromDisk(): Promise<Record<string, number>> {
        const exist = await this.app.vault.adapter.exists(
            this.settingsService.get().fileMtimePath
        );

        if (!exist) {
            return {};
        }
        const content = await this.app.vault.adapter.read(
            this.settingsService.get().fileMtimePath
        );
        return JSON.parse(content);
    }
}
