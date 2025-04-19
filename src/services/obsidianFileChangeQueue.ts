import type { EventRef, TFile, Vault } from "obsidian";

export type FileChange = {
    path: string;
    reason: "new" | "modified" | "deleted";
    hash?: string;
};

export type FileChangeQueueOptions = {
    vault: Vault;
    hashFunc?: (content: string) => Promise<string>;
};

/**
 * Class for managing file changes in an Obsidian vault
 */
export class FileChangeQueue {
    /**
     * Queue of file changes to be processed
     */
    private queue: FileChange[] = [];

    /**
     * Current file hash map
     */
    private fileHashes: Record<string, string> = {};

    /**
     * Options for the queue
     */
    private options: FileChangeQueueOptions;

    /**
     * Event references for cleanup
     */
    private eventRefs: EventRef[] = [];

    /**
     * Creates a new file change queue
     */
    constructor(options: FileChangeQueueOptions) {
        this.options = options;
    }

    /**
     * Initializes the file change queue by comparing the vault with the previous state
     * and adding changed files to the queue
     */
    public async initialize(metadata: Record<string, string>): Promise<void> {
        this.fileHashes = metadata;

        const { vault } = this.options;

        // Get all markdown files in the vault
        const files = vault.getMarkdownFiles();

        // Calculate current hashes and detect changes
        const currentHashes: Record<string, string> = {};
        const newQueue: FileChange[] = [];

        // Process existing files
        for (const file of files) {
            const content = await vault.read(file);
            const hashFunc =
                this.options.hashFunc ?? FileChangeQueue.calculateFileHash;
            const hash = await hashFunc(content);
            currentHashes[file.path] = hash;

            // Check if file is new or modified
            if (!this.fileHashes[file.path]) {
                newQueue.push({ path: file.path, reason: "new", hash });
            } else if (this.fileHashes[file.path] !== hash) {
                newQueue.push({ path: file.path, reason: "modified", hash });
            }
        }

        // Check for deleted files
        for (const path in this.fileHashes) {
            if (!currentHashes[path]) {
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
                const content = await vault.read(file);
                const hashFunc =
                    this.options.hashFunc ?? FileChangeQueue.calculateFileHash;
                const hash = await hashFunc(content);

                // Add to queue with hash
                this.queue.push({
                    path: file.path,
                    reason: "new" as const,
                    hash,
                });
            }
        });
        this.eventRefs.push(createRef);

        // Register callback for file modification
        const modifyRef = vault.on("modify", async (file: TFile) => {
            if (file.extension === "md") {
                const content = await vault.read(file);
                const hashFunc =
                    this.options.hashFunc ?? FileChangeQueue.calculateFileHash;
                const hash = await hashFunc(content);

                // Remove the file from the queue if it exists
                this.queue = this.queue.filter(
                    (change) => change.path !== file.path
                );

                // Add to queue with hash
                this.queue.push({
                    path: file.path,
                    reason: "modified" as const,
                    hash,
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
        for (const ref of this.eventRefs) {
            if (typeof ref === "function") {
                ref();
            }
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
    public async enqueueAllFiles(): Promise<void> {
        const { vault } = this.options;

        // Get all markdown files in the vault
        const files = vault.getMarkdownFiles();

        // Add all files to the queue with their current hashes
        const newQueue: FileChange[] = [];

        for (const file of files) {
            const content = await vault.read(file);
            const hashFunc =
                this.options.hashFunc ?? FileChangeQueue.calculateFileHash;
            const hash = await hashFunc(content);

            newQueue.push({
                path: file.path,
                reason: "modified",
                hash,
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
    public pollFileChanges(maxCount: number): FileChange[] {
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
     * Helper function to calculate a SHA-256 hash for a file's content
     */
    public static async calculateFileHash(content: string): Promise<string> {
        // Convert the string to a Uint8Array
        const encoder = new TextEncoder();
        const data = encoder.encode(content);

        // Calculate SHA-256 hash
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);

        // Convert the hash to a hex string
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

        return hashHex;
    }

    /**
     * Marks a file change as processed by updating the hash store
     * This should be called after processing a file change to ensure it's not reprocessed
     * if the application restarts before the hash store is updated
     */
    public async markFileChangeProcessed(change: FileChange): Promise<void> {
        if (change.reason === "deleted") {
            delete this.fileHashes[change.path];
        } else if (change.hash) {
            // Update the hash store with the processed hash
            this.fileHashes[change.path] = change.hash;
        }
    }

    public getMetadata(): Record<string, string> {
        return this.fileHashes;
    }
}
