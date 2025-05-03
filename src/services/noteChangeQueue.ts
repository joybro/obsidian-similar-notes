import type { EventRef, TFile, Vault } from "obsidian";

export type NoteChange = {
    path: string;
    reason: "new" | "modified" | "deleted";
    mtime?: number;
};

export type NoteChangeQueueOptions = {
    vault: Vault;
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
     * Current file hash map
     */
    private mtimes: Record<string, number> = {};

    /**
     * Options for the queue
     */
    private options: NoteChangeQueueOptions;

    /**
     * Event references for cleanup
     */
    private eventRefs: EventRef[] = [];

    /**
     * Creates a new file change queue
     */
    constructor(options: NoteChangeQueueOptions) {
        this.options = options;
    }

    /**
     * Initializes the file change queue by comparing the vault with the previous state
     * and adding changed files to the queue
     */
    public async initialize(metadata: Record<string, number>): Promise<void> {
        this.mtimes = metadata;

        const { vault } = this.options;

        // Get all markdown files in the vault
        const files = vault.getMarkdownFiles();

        // Calculate current hashes and detect changes
        const currentMtimes: Record<string, number> = {};
        const newQueue: NoteChange[] = [];

        // Process existing files
        for (const file of files) {
            currentMtimes[file.path] = file.stat.mtime;

            // Check if file is new or modified
            if (!this.mtimes[file.path]) {
                newQueue.push({
                    path: file.path,
                    reason: "new",
                    mtime: file.stat.mtime,
                });
            } else if (this.mtimes[file.path] !== file.stat.mtime) {
                newQueue.push({
                    path: file.path,
                    reason: "modified",
                    mtime: file.stat.mtime,
                });
            }
        }

        // Check for deleted files
        for (const path in this.mtimes) {
            if (!currentMtimes[path]) {
                newQueue.push({ path, reason: "deleted" });
            }
        }

        // Update state
        this.queue = newQueue;

        // Register file change event callbacks
        this.registerFileChangeCallbacks();
    }

    /**
     * Registers callbacks for file change events in the Vault
     */
    private registerFileChangeCallbacks(): void {
        const { vault } = this.options;

        // Clear any existing event refs
        this.unregisterFileChangeCallbacks();

        // Register callback for file creation
        const createRef = vault.on("create", async (file: TFile) => {
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
        const modifyRef = vault.on("modify", async (file: TFile) => {
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
        const deleteRef = vault.on("delete", (file: TFile) => {
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
        const { vault } = this.options;

        for (const ref of this.eventRefs) {
            vault.offref(ref);
        }

        this.eventRefs = [];
    }

    /**
     * Cleans up the file change queue by unregistering all callbacks
     * This should be called when the queue is no longer needed
     */
    public cleanup(): void {
        this.unregisterFileChangeCallbacks();
    }

    /**
     * Adds all files to the queue regardless of whether they've changed
     */
    public async enqueueAllNotes(): Promise<void> {
        const { vault } = this.options;

        // Get all markdown files in the vault
        const files = vault.getMarkdownFiles();

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
    public pollFileChanges(maxCount: number): NoteChange[] {
        const changes = this.queue.slice(0, maxCount);
        this.queue = this.queue.slice(maxCount);
        return changes;
    }

    /**
     * Returns the number of changes remaining in the queue
     */
    public getFileChangeCount(): number {
        return this.queue.length;
    }

    /**
     * Marks a file change as processed by updating the hash store
     * This should be called after processing a file change to ensure it's not reprocessed
     * if the application restarts before the hash store is updated
     */
    public async markNoteChangeProcessed(change: NoteChange): Promise<void> {
        if (change.reason === "deleted") {
            delete this.mtimes[change.path];
        } else if (change.mtime) {
            // Update the hash store with the processed hash
            this.mtimes[change.path] = change.mtime;
        }
    }

    public getMetadata(): Record<string, number> {
        return this.mtimes;
    }
}
