import type { SettingsService } from "@/application/SettingsService";
import type { IndexedNoteMTimeStore } from "@/infrastructure/IndexedNoteMTimeStore";
import { filterMarkdownFiles } from "@/utils/folderExclusion";
import log from "loglevel";
import type { EventRef, TFile, Vault } from "obsidian";

export type NoteChange = {
    path: string;
    reason: "new" | "modified" | "deleted";
    mtime?: number;
};

/**
 * Class for managing file changes in an Obsidian vault
 */
export class NoteChangeQueue {
    /**
     * Queue of file changes to be processed
     */
    private queue: NoteChange[] = [];

    /**
     * Event references for cleanup
     */
    private eventRefs: EventRef[] = [];

    /**
     * Creates a new file change queue
     */
    constructor(
        private vault: Vault, 
        private mTimeStore: IndexedNoteMTimeStore,
        private settingsService: SettingsService
    ) {}

    /**
     * Initializes the file change queue by comparing the vault with the previous state
     * and adding changed files to the queue
     */
    async initialize(): Promise<void> {
        // Get all markdown files in the vault
        const allFiles = this.vault.getMarkdownFiles();
        const settings = this.settingsService.get();
        const files = filterMarkdownFiles(allFiles, settings.excludeFolderPatterns);

        // Calculate current hashes and detect changes
        const currentMtimes: Record<string, number> = {};
        const newQueue: NoteChange[] = [];

        // Process existing files
        for (const file of files) {
            currentMtimes[file.path] = file.stat.mtime;
            const mtime = await this.mTimeStore.getMTime(file.path);

            // Check if file is new or modified
            if (!mtime) {
                newQueue.push({
                    path: file.path,
                    reason: "new",
                    mtime: file.stat.mtime,
                });
            } else if (mtime !== file.stat.mtime) {
                newQueue.push({
                    path: file.path,
                    reason: "modified",
                    mtime: file.stat.mtime,
                });
            }
        }

        // Check for deleted files and files excluded by patterns
        const validFiles: Record<string, boolean> = {};
        for (const path in currentMtimes) {
            validFiles[path] = true;
        }
        const deletedFiles = this.findDeletedAndExcludedFiles(validFiles);
        newQueue.push(...deletedFiles);

        // Update state
        this.queue = newQueue;
        log.info("queue size", this.queue.length);

        // Register file change event callbacks
        this.registerFileChangeCallbacks();
    }

    /**
     * Registers callbacks for file change events in the Vault
     */
    private registerFileChangeCallbacks(): void {
        // Clear any existing event refs
        this.unregisterFileChangeCallbacks();

        // Register callback for file creation
        const createRef = this.vault.on("create", async (file: TFile) => {
            if (file.extension === "md") {
                const settings = this.settingsService.get();
                // Check if file should be excluded
                const files = filterMarkdownFiles([file], settings.excludeFolderPatterns);
                if (files.length > 0) {
                    // Add to queue with hash
                    this.queue.push({
                        path: file.path,
                        reason: "new" as const,
                        mtime: file.stat.mtime,
                    });
                }
            }
        });
        this.eventRefs.push(createRef);

        // Register callback for file modification
        const modifyRef = this.vault.on("modify", async (file: TFile) => {
            if (file.extension === "md") {
                const settings = this.settingsService.get();
                // Check if file should be excluded
                const files = filterMarkdownFiles([file], settings.excludeFolderPatterns);
                if (files.length > 0) {
                    // Remove the file from the queue if it exists
                    this.queue = this.queue.filter(
                        (change) => change.path !== file.path
                    );

                    // Add to queue with hash
                    this.queue.push({
                        path: file.path,
                        reason: "modified" as const,
                        mtime: file.stat.mtime,
                    });
                }
            }
        });
        this.eventRefs.push(modifyRef);

        // Register callback for file deletion
        const deleteRef = this.vault.on("delete", (file: TFile) => {
            if (file.extension === "md") {
                // Remove the file from the queue if it exists
                this.queue = this.queue.filter(
                    (change) => change.path !== file.path
                );

                // Add to queue (no hash for deleted files)
                this.queue.push({
                    path: file.path,
                    reason: "deleted" as const,
                });
            }
        });
        this.eventRefs.push(deleteRef);
    }

    /**
     * Unregisters all file change callbacks
     */
    private unregisterFileChangeCallbacks(): void {
        // Clear all event refs
        for (const ref of this.eventRefs) {
            this.vault.offref(ref);
        }

        this.eventRefs = [];
    }

    /**
     * Cleans up the file change queue by unregistering all callbacks
     * This should be called when the queue is no longer needed
     */
    cleanup(): void {
        this.unregisterFileChangeCallbacks();
    }

    /**
     * Adds all files to the queue regardless of whether they've changed
     */
    async enqueueAllNotes(): Promise<void> {
        // Get all markdown files in the vault
        const allFiles = this.vault.getMarkdownFiles();
        const settings = this.settingsService.get();
        const files = filterMarkdownFiles(allFiles, settings.excludeFolderPatterns);

        // Add all files to the queue with their current hashes
        const newQueue: NoteChange[] = [];

        for (const file of files) {
            newQueue.push({
                path: file.path,
                reason: "modified",
                mtime: file.stat.mtime,
            });
        }

        this.queue = newQueue;
    }

    /**
     * Polls up to maxCount items from the queue
     * Items removed from the queue are considered processed
     *
     * Note: After processing each change, you should call markFileChangeProcessed
     * to ensure the hash store is updated, preventing reprocessing if the application
     * restarts before the hash store is updated.
     */
    pollFileChanges(maxCount: number): NoteChange[] {
        const changes = this.queue.slice(0, maxCount);
        this.queue = this.queue.slice(maxCount);
        return changes;
    }

    /**
     * Returns the number of changes remaining in the queue
     */
    getFileChangeCount(): number {
        return this.queue.length;
    }

    /**
     * Marks a file change as processed by updating the hash store
     * This should be called after processing a file change to ensure it's not reprocessed
     * if the application restarts before the hash store is updated
     */
    async markNoteChangeProcessed(change: NoteChange): Promise<void> {
        if (change.reason === "deleted") {
            this.mTimeStore.deleteMTime(change.path);
        } else if (change.mtime) {
            // Update the hash store with the processed hash
            this.mTimeStore.setMTime(change.path, change.mtime);
        }
    }

    /**
     * Applies current exclusion patterns by synchronizing the index with current patterns.
     * This handles both newly excluded files (removes them) and newly included files (adds them).
     * This is more efficient than a full reindex as it only processes the changed files.
     * 
     * @returns Promise that resolves to an object with counts of changes
     */
    async applyExclusionPatterns(): Promise<{ removed: number; added: number }> {
        const allFiles = this.vault.getMarkdownFiles();
        const settings = this.settingsService.get();
        const filteredFiles = filterMarkdownFiles(allFiles, settings.excludeFolderPatterns);
        
        // Create map of currently valid files (should be indexed)
        const shouldBeIndexed: Record<string, number> = {};
        for (const file of filteredFiles) {
            shouldBeIndexed[file.path] = file.stat.mtime;
        }

        // Create map of currently indexed files
        const currentlyIndexed = new Set(this.mTimeStore.getAllPaths());

        const changes: NoteChange[] = [];
        let removedCount = 0;
        let addedCount = 0;

        // Find files that should be removed (currently indexed but should not be)
        for (const indexedPath of currentlyIndexed) {
            if (!shouldBeIndexed[indexedPath]) {
                changes.push({ path: indexedPath, reason: "deleted" });
                removedCount++;
            }
        }

        // Find files that should be added (not currently indexed but should be)
        for (const [filePath, mtime] of Object.entries(shouldBeIndexed)) {
            if (!currentlyIndexed.has(filePath)) {
                changes.push({ 
                    path: filePath, 
                    reason: "new",
                    mtime: mtime
                });
                addedCount++;
            }
        }
        
        // Add all changes to queue for processing
        this.queue.push(...changes);
        
        log.info(`Applied exclusion patterns: ${removedCount} files queued for removal, ${addedCount} files queued for addition`);
        return { removed: removedCount, added: addedCount };
    }

    /**
     * Preview how many files would be changed by applying current exclusion patterns
     * without actually queuing them for processing.
     * 
     * @returns Object with counts of files that would be removed and added
     */
    previewExclusionApplication(): { removed: number; added: number } {
        const allFiles = this.vault.getMarkdownFiles();
        const settings = this.settingsService.get();
        const filteredFiles = filterMarkdownFiles(allFiles, settings.excludeFolderPatterns);
        
        // Create map of currently valid files (should be indexed)
        const shouldBeIndexed = new Set<string>();
        for (const file of filteredFiles) {
            shouldBeIndexed.add(file.path);
        }

        // Create map of currently indexed files
        const currentlyIndexed = new Set(this.mTimeStore.getAllPaths());

        let removedCount = 0;
        let addedCount = 0;

        // Count files that would be removed
        for (const indexedPath of currentlyIndexed) {
            if (!shouldBeIndexed.has(indexedPath)) {
                removedCount++;
            }
        }

        // Count files that would be added
        for (const validPath of shouldBeIndexed) {
            if (!currentlyIndexed.has(validPath)) {
                addedCount++;
            }
        }

        return { removed: removedCount, added: addedCount };
    }

    /**
     * Helper method to find files that are deleted or excluded by current patterns
     * 
     * @param validFiles Map of file paths that should remain in the index
     * @returns Array of NoteChange objects for files to be removed
     */
    private findDeletedAndExcludedFiles(validFiles: Record<string, boolean>): NoteChange[] {
        const deletedFiles: NoteChange[] = [];
        
        for (const path of this.mTimeStore.getAllPaths()) {
            if (!validFiles[path]) {
                deletedFiles.push({ path, reason: "deleted" });
            }
        }
        
        return deletedFiles;
    }
}
