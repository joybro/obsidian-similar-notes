import type { SettingsService } from "@/application/SettingsService";
import type { IndexedNoteMTimeStore } from "@/infrastructure/IndexedNoteMTimeStore";
import { filterMarkdownFiles } from "@/utils/folderExclusion";
import log from "loglevel";
import { TFile } from "obsidian";
import type { EventRef, TAbstractFile, Vault } from "obsidian";

export type NoteChange = {
    path: string;
    reason: "new" | "modified" | "deleted";
    mtime?: number;
};

interface FileInfo {
    path: string;
    mtime: number;
}

interface SyncAnalysis {
    toAdd: FileInfo[];      // Files that need to be added to the index
    toRemove: string[];     // Files that need to be removed from the index
    toUpdate: FileInfo[];   // Files that have changed mtime and need updating
    counts: { added: number; removed: number; updated: number };
}

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
        // Analyze what files need to be synchronized (including mtime checks)
        const analysis = this.analyzeSyncNeeds(true);
        
        // Create changes from analysis
        this.queue = this.createChanges(analysis);
        
        log.info("queue size", this.queue.length);
        log.info(`Sync analysis: ${analysis.counts.added} to add, ${analysis.counts.removed} to remove, ${analysis.counts.updated} to update`);

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

        // Register callback for file rename/move
        const renameRef = this.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
            if (file instanceof TFile && file.extension === "md") {
                const settings = this.settingsService.get();

                // Remove old path from queue if it exists
                this.queue = this.queue.filter(
                    (change) => change.path !== oldPath && change.path !== file.path
                );

                // Add deletion change for old path to clean up old data
                this.queue.push({
                    path: oldPath,
                    reason: "deleted" as const,
                });

                // Check if new path should be indexed (not excluded by patterns)
                const files = filterMarkdownFiles([file], settings.excludeFolderPatterns);
                if (files.length > 0) {
                    // Add new path to queue for indexing
                    this.queue.push({
                        path: file.path,
                        reason: "new" as const,
                        mtime: file.stat.mtime,
                    });
                    log.info(`File renamed/moved: ${oldPath} -> ${file.path}`);
                } else {
                    log.info(`File renamed/moved to excluded location: ${oldPath} -> ${file.path}`);
                }
            }
        });
        this.eventRefs.push(renameRef);
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
        // Get all files that should be indexed according to current patterns
        const allFiles = this.vault.getMarkdownFiles();
        const settings = this.settingsService.get();
        const filteredFiles = filterMarkdownFiles(allFiles, settings.excludeFolderPatterns);
        
        // Create "modified" changes for all valid files (force reprocessing of everything)
        const newQueue: NoteChange[] = [];
        
        for (const file of filteredFiles) {
            newQueue.push({
                path: file.path,
                reason: "modified",
                mtime: file.stat.mtime,
            });
        }
        
        this.queue = newQueue;
        log.info(`Enqueued all notes: ${newQueue.length} files queued for reprocessing`);
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
     * Analyzes what files need to be synchronized between vault and index
     * 
     * @param checkMtime Whether to check modification times for existing indexed files
     * @returns Analysis of files that need to be added, removed, or updated
     */
    private analyzeSyncNeeds(checkMtime = true): SyncAnalysis {
        // Get all markdown files and apply current exclusion patterns
        const allFiles = this.vault.getMarkdownFiles();
        const settings = this.settingsService.get();
        const filteredFiles = filterMarkdownFiles(allFiles, settings.excludeFolderPatterns);
        
        // Create map of files that should be indexed (according to current patterns)
        const shouldBeIndexed = new Map<string, number>();
        for (const file of filteredFiles) {
            shouldBeIndexed.set(file.path, file.stat.mtime);
        }
        
        // Get currently indexed files
        const currentlyIndexed = new Set(this.mTimeStore.getAllPaths());
        
        const toAdd: FileInfo[] = [];
        const toRemove: string[] = [];
        const toUpdate: FileInfo[] = [];
        
        // Find files that should be added (not currently indexed but should be)
        for (const [filePath, mtime] of shouldBeIndexed) {
            if (!currentlyIndexed.has(filePath)) {
                toAdd.push({ path: filePath, mtime });
            } else if (checkMtime) {
                // Check if existing indexed file needs update
                const storedMtime = this.mTimeStore.getMTime(filePath);
                if (storedMtime !== mtime) {
                    toUpdate.push({ path: filePath, mtime });
                }
            }
        }
        
        // Find files that should be removed (currently indexed but should not be)
        for (const indexedPath of currentlyIndexed) {
            if (!shouldBeIndexed.has(indexedPath)) {
                toRemove.push(indexedPath);
            }
        }
        
        return {
            toAdd,
            toRemove,
            toUpdate,
            counts: {
                added: toAdd.length,
                removed: toRemove.length,
                updated: toUpdate.length
            }
        };
    }

    /**
     * Creates NoteChange objects from sync analysis
     */
    private createChanges(analysis: SyncAnalysis): NoteChange[] {
        const changes: NoteChange[] = [];
        
        // Add new files
        for (const fileInfo of analysis.toAdd) {
            changes.push({
                path: fileInfo.path,
                reason: "new",
                mtime: fileInfo.mtime
            });
        }
        
        // Update modified files
        for (const fileInfo of analysis.toUpdate) {
            changes.push({
                path: fileInfo.path,
                reason: "modified", 
                mtime: fileInfo.mtime
            });
        }
        
        // Remove deleted/excluded files
        for (const filePath of analysis.toRemove) {
            changes.push({
                path: filePath,
                reason: "deleted"
            });
        }
        
        return changes;
    }

    /**
     * Marks a file change as processed by updating the hash store
     * This should be called after processing a file change to ensure it's not reprocessed
     * if the application restarts before the hash store is updated
     */
    async markNoteChangeProcessed(change: NoteChange): Promise<void> {
        if (change.reason === "deleted") {
            await this.mTimeStore.deleteMTime(change.path);
        } else if (change.mtime) {
            // Update the hash store with the processed hash
            await this.mTimeStore.setMTime(change.path, change.mtime);
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
        // Analyze sync needs without checking mtime (we only care about inclusion/exclusion)
        const analysis = this.analyzeSyncNeeds(false);
        
        // Create changes from analysis
        const changes = this.createChanges(analysis);
        
        // Add all changes to queue for processing
        this.queue.push(...changes);
        
        log.info(`Applied exclusion patterns: ${analysis.counts.removed} files queued for removal, ${analysis.counts.added} files queued for addition`);
        return { removed: analysis.counts.removed, added: analysis.counts.added };
    }

    /**
     * Preview how many files would be changed by applying current exclusion patterns
     * without actually queuing them for processing.
     * 
     * @returns Object with counts of files that would be removed and added
     */
    previewExclusionApplication(): { removed: number; added: number } {
        // Analyze sync needs without checking mtime (we only care about inclusion/exclusion)
        const analysis = this.analyzeSyncNeeds(false);
        
        return { removed: analysis.counts.removed, added: analysis.counts.added };
    }

}
