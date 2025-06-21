import type { MTimeStore } from "@/infrastructure/MTimeStore";
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
    constructor(private vault: Vault, private mTimeStore: MTimeStore) {}

    /**
     * Initializes the file change queue by comparing the vault with the previous state
     * and adding changed files to the queue
     */
    async initialize(): Promise<void> {
        // Get all markdown files in the vault
        const files = this.vault.getMarkdownFiles();

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

        // Check for deleted files
        for (const path of this.mTimeStore.getAllPaths()) {
            if (!currentMtimes[path]) {
                newQueue.push({ path, reason: "deleted" });
            }
        }

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
                // Add to queue with hash
                this.queue.push({
                    path: file.path,
                    reason: "new" as const,
                    mtime: file.stat.mtime,
                });
            }
        });
        this.eventRefs.push(createRef);

        // Register callback for file modification
        const modifyRef = this.vault.on("modify", async (file: TFile) => {
            if (file.extension === "md") {
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
        const files = this.vault.getMarkdownFiles();

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
}
