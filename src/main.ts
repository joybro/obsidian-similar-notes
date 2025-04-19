import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import log from "loglevel";
import type { EventRef, WorkspaceLeaf } from "obsidian";
import { MarkdownView, Plugin, TFile } from "obsidian";
import { SimilarNotesSettingTab } from "./components/SimilarNotesSettingTab";
import { SimilarNotesView } from "./components/SimilarNotesView";
import { EmbeddingModelService } from "./services/model/embeddingModelService";
import { NoteChangeQueue } from "./services/noteChangeQueue";
import type {
    EmbeddedChunk,
    EmbeddedChunkStore,
} from "./services/storage/embeddedChunkStore";
import { OramaEmbeddedChunkStore } from "./services/storage/oramaEmbeddedChunkStore";

interface SimilarNotesSettings {
    dbPath: string;
    autoSaveInterval: number; // in minutes
    fileHashStorePath: string;
    modelId: string; // The model ID to use for embeddings
}

const DEFAULT_SETTINGS: SimilarNotesSettings = {
    dbPath: ".obsidian/similar-notes.json",
    autoSaveInterval: 5,
    fileHashStorePath: ".obsidian/similar-notes-file-hashes.json",
    modelId: "sentence-transformers/all-MiniLM-L6-v2",
};

export default class MainPlugin extends Plugin {
    private similarNotesViews: Map<WorkspaceLeaf, SimilarNotesView> = new Map();
    private eventRefs: EventRef[] = [];
    private settings: SimilarNotesSettings;
    private embeddingStore: EmbeddedChunkStore;
    private autoSaveInterval: NodeJS.Timeout;
    private fileChangeQueue: NoteChangeQueue;
    private modelService: EmbeddingModelService;
    private fileChangeLoop: () => Promise<void>;
    private fileChangeLoopTimer: NodeJS.Timeout;
    async onload() {
        log.setDefaultLevel(log.levels.INFO);
        log.info("Loading Similar Notes plugin");

        // Load settings
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );

        // Initialize model service
        try {
            this.modelService = new EmbeddingModelService();
            await this.modelService.loadModel(this.settings.modelId);

            log.info("Model service initialized successfully");
        } catch (error) {
            log.error("Failed to initialize model service:", error);
        }

        // Initialize store
        await this.initializeStore(this.modelService.getVectorSize());

        // Setup auto-save interval
        this.setupAutoSave();

        // Add settings tab
        this.addSettingTab(new SimilarNotesSettingTab(this.app, this));

        // Register event when active leaf changes
        const leafChangeRef = this.app.workspace.on(
            "active-leaf-change",
            async (leaf) => {
                if (leaf && leaf.view instanceof MarkdownView) {
                    await this.updateSimilarNotesView(leaf);
                }
            }
        );
        this.eventRefs.push(leafChangeRef);
        this.registerEvent(leafChangeRef);

        // Register event when current open file changes
        const fileOpenRef = this.app.workspace.on("file-open", async (file) => {
            if (file && file instanceof TFile) {
                const activeLeaf = this.app.workspace.activeLeaf;
                if (activeLeaf && activeLeaf.view instanceof MarkdownView) {
                    await this.updateSimilarNotesView(activeLeaf);
                }
            }
        });
        this.eventRefs.push(fileOpenRef);
        this.registerEvent(fileOpenRef);

        // Initialize file change queue
        this.app.workspace.onLayoutReady(async () => {
            this.fileChangeQueue = new NoteChangeQueue({
                vault: this.app.vault,
            });
            const queueMetadata = await this.loadQueueMetadataFromDisk();
            await this.fileChangeQueue.initialize(queueMetadata);

            const statusBarItem = this.addStatusBarItem();

            const splitter = RecursiveCharacterTextSplitter.fromLanguage(
                "markdown",
                {
                    chunkSize: this.modelService.getMaxTokens(),
                    chunkOverlap: 100,
                    lengthFunction: (text) =>
                        this.modelService.countTokens(text),
                }
            );

            const processDeletedNote = async (path: string) => {
                await this.embeddingStore.removeByPath(path);
            };

            const processUpdatedNote = async (path: string) => {
                const file = this.app.vault.getFileByPath(path);
                if (!file) {
                    log.error("file not found", path);
                    return;
                }

                const content = await this.app.vault.cachedRead(file);
                if (content.length === 0) {
                    return;
                }

                const chunks = await splitter.splitText(content);
                log.info("chunks", chunks);

                const embeddings = await this.modelService.embedTexts(chunks);
                log.info("embeddings", embeddings);

                const embeddedChunks: EmbeddedChunk[] = embeddings.map(
                    (embedding, index) => ({
                        path: file.path,
                        title: file.name,
                        embedding,
                        content: chunks[index],
                        chunkIndex: index,
                        totalChunks: chunks.length,
                        lastUpdated: Date.now(),
                    })
                );

                await this.embeddingStore.removeByPath(file.path);
                await this.embeddingStore.addMulti(embeddedChunks);

                log.info(
                    "count of chunks in embedding store",
                    this.embeddingStore.count()
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
        if (this.embeddingStore) {
            try {
                await this.embeddingStore.save();
                await this.embeddingStore.close();
            } catch (e) {
                log.error("Error while closing embedding store:", e);
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

        // Manually unregister events (though this is redundant with this.registerEvent)
        for (const eventRef of this.eventRefs) {
            this.app.workspace.offref(eventRef);
        }

        // Clean up all created views
        for (const view of Array.from(this.similarNotesViews.values())) {
            const containerEl = view.getContainerEl();
            if (containerEl?.parentNode) {
                containerEl.parentNode.removeChild(containerEl);
            }
            view.unload();
        }
        this.similarNotesViews.clear();
    }

    // Update Similar Notes view for the active leaf
    private async updateSimilarNotesView(leaf: WorkspaceLeaf): Promise<void> {
        if (!(leaf.view instanceof MarkdownView)) return;

        const file = leaf.view.file;
        if (!file) return;

        // If view already exists for this leaf, update it
        if (this.similarNotesViews.has(leaf)) {
            await this.similarNotesViews.get(leaf)?.updateForFile(file);
            return;
        }

        // Create new view
        // Find embedded backlinks container
        const embeddedBacklinksContainer = leaf.view.containerEl.querySelector(
            ".embedded-backlinks"
        );

        if (embeddedBacklinksContainer?.parentElement) {
            // Insert similar notes section before embedded backlinks container
            const similarNotesView = new SimilarNotesView(
                this.app,
                embeddedBacklinksContainer.parentElement,
                (file) => this.getSimilarNotes(file)
            );

            this.similarNotesViews.set(leaf, similarNotesView);
            await similarNotesView.updateForFile(file);

            // Move similar notes container before embedded backlinks container
            const similarNotesContainer = similarNotesView.getContainerEl();
            embeddedBacklinksContainer.parentElement.insertBefore(
                similarNotesContainer,
                embeddedBacklinksContainer
            );
        }
    }

    // Get similar notes (dummy data)
    private async getSimilarNotes(file: TFile) {
        // Currently returns dummy data
        // Will be replaced with actual embedding and similarity search later
        const allFiles = this.app.vault
            .getMarkdownFiles()
            .filter((f) => f.path !== file.path);

        // Randomly select up to 5 files
        const randomFiles = allFiles
            .sort(() => 0.5 - Math.random())
            .slice(0, Math.min(5, allFiles.length));

        const similarNotes = await Promise.all(
            randomFiles.map(async (f) => {
                return {
                    file: f,
                    title: f.basename,
                    // Dummy similarity score (between 0.6 and 0.95)
                    similarity: 0.6 + Math.random() * 0.35,
                };
            })
        );

        // Sort by similarity score in descending order
        return similarNotes.sort(
            (a, b) => (b.similarity || 0) - (a.similarity || 0)
        );
    }

    // Handle reindexing of notes
    async reindexNotes(): Promise<void> {
        this.fileChangeQueue.enqueueAllNotes();

        // Refresh all views after reindexing
        for (const [leaf, view] of Array.from(
            this.similarNotesViews.entries()
        )) {
            if (leaf.view instanceof MarkdownView && leaf.view.file) {
                await view.updateForFile(leaf.view.file);
            }
        }
    }

    private async initializeStore(vectorSize: number) {
        try {
            // Create store instance
            this.embeddingStore = new OramaEmbeddedChunkStore(
                this.app.vault,
                this.settings.dbPath,
                vectorSize
            );

            // Initialize store
            await this.embeddingStore.init();

            // Try to load existing database
            try {
                await this.embeddingStore.load(this.settings.dbPath);
                const count = this.embeddingStore.count();
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
                await this.embeddingStore.load(this.settings.dbPath);
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
        this.app.vault.adapter.write(
            this.settings.fileHashStorePath,
            JSON.stringify(metadata)
        );
    }

    private async loadQueueMetadataFromDisk(): Promise<Record<string, string>> {
        const exist = await this.app.vault.adapter.exists(
            this.settings.fileHashStorePath
        );

        if (!exist) {
            return {};
        }
        const content = await this.app.vault.adapter.read(
            this.settings.fileHashStorePath
        );
        return JSON.parse(content);
    }
}
