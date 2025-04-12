import type { EventRef, WorkspaceLeaf } from "obsidian";
import { MarkdownView, Plugin, TFile } from "obsidian";
import { SimilarNotesSettingTab } from "./components/SimilarNotesSettingTab";
import { SimilarNotesView } from "./components/SimilarNotesView";
import { JsonFileHashStore } from "./services/jsonFileHashStore";
import { EmbeddingModelService } from "./services/model/embeddingModelService";
import { FileChangeQueue } from "./services/obsidianFileChangeQueue";
import type { EmbeddedChunkStore } from "./services/storage/embeddedChunkStore";
import { OramaEmbeddedChunkStore } from "./services/storage/oramaEmbeddedChunkStore";

// OpenAI embedding dimension
const VECTOR_SIZE = 1536;

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
    private store: EmbeddedChunkStore;
    private autoSaveInterval: NodeJS.Timeout;
    private fileChangeQueue: FileChangeQueue;
    private fileChangeQueueInterval: NodeJS.Timeout;
    private modelService: EmbeddingModelService;

    async onload() {
        console.log("Loading Similar Notes plugin");

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
            console.log("Model service initialized successfully");
        } catch (error) {
            console.error("Failed to initialize model service:", error);
        }

        // Initialize store
        await this.initializeStore();

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
            const hashStore = new JsonFileHashStore(
                this.settings.fileHashStorePath,
                this.app.vault
            );
            this.fileChangeQueue = new FileChangeQueue({
                vault: this.app.vault,
                hashStore,
            });
            await this.fileChangeQueue.initialize();

            const statusBarItem = this.addStatusBarItem();

            // Set up file change queue interval
            this.fileChangeQueueInterval = setInterval(async () => {
                const count = this.fileChangeQueue.getFileChangeCount();
                if (count > 10) {
                    statusBarItem.setText(`${count} to index`);
                    statusBarItem.show();
                } else {
                    statusBarItem.hide();
                }

                const changes = await this.fileChangeQueue.pollFileChanges(100);
                for (const change of changes) {
                    console.log("processing change", change.path);
                    await this.fileChangeQueue.markFileChangeProcessed(change);
                }
            }, 1000);
        });
    }

    async onunload() {
        // Cleanup file change queue
        if (this.fileChangeQueue) {
            this.fileChangeQueue.cleanup();
        }
        if (this.fileChangeQueueInterval) {
            clearInterval(this.fileChangeQueueInterval);
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
        if (this.store) {
            try {
                await this.store.save();
                await this.store.close();
            } catch (e) {
                console.error("Error while closing store:", e);
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
        this.fileChangeQueue.enqueueAllFiles();

        // Refresh all views after reindexing
        for (const [leaf, view] of Array.from(
            this.similarNotesViews.entries()
        )) {
            if (leaf.view instanceof MarkdownView && leaf.view.file) {
                await view.updateForFile(leaf.view.file);
            }
        }
    }

    private async initializeStore() {
        try {
            // Create store instance
            this.store = new OramaEmbeddedChunkStore(
                this.app.vault,
                this.settings.dbPath,
                VECTOR_SIZE
            );

            // Initialize store
            await this.store.init();

            // Try to load existing database
            try {
                await this.store.load(this.settings.dbPath);
                console.log(
                    "Successfully loaded existing database from",
                    this.settings.dbPath
                );
            } catch (e) {
                console.log(
                    "No existing database found at",
                    this.settings.dbPath,
                    "- starting fresh"
                );
            }
        } catch (e) {
            console.error("Failed to initialize store:", e);
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
                await this.store.save();
                console.log("Auto-saved database");
            } catch (e) {
                console.error("Failed to auto-save database:", e);
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
}
