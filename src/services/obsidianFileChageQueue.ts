import type { EventRef, TFile, Vault } from "obsidian";

export type FileChange = {
    path: string;
    reason: "new" | "modified" | "deleted";
    hash?: string;
};

export type FileHashStore = {
    /**
     * Loads the previous state of file hash map
     * Example: { "path/to/file.md": "abc123" }
     */
    load(): Promise<Record<string, string>>;

    /**
     * Saves the updated hash map
     */
    save(data: Record<string, string>): Promise<void>;
};

export type FileChangeQueueOptions = {
    vault: Vault;
    hashStore: FileHashStore;
    hashFunc?: (content: string) => Promise<string>;
};

/**
 * State for the file change queue
 */
export type FileChangeQueueState = {
    /**
     * Queue of file changes to be processed
     */
    queue: FileChange[];

    /**
     * Current file hash map
     */
    fileHashes: Record<string, string>;

    /**
     * Options for the queue
     */
    options: FileChangeQueueOptions;

    /**
     * Event references for cleanup
     */
    eventRefs: EventRef[];
};

/**
 * Creates a new file change queue state
 */
export const createFileChangeQueue = (
    options: FileChangeQueueOptions
): FileChangeQueueState => {
    return {
        queue: [],
        fileHashes: {},
        options,
        eventRefs: [],
    };
};

/**
 * Initializes the file change queue by comparing the vault with the previous state
 * and adding changed files to the queue
 */
export const initializeFileChangeQueue = async (
    state: FileChangeQueueState
): Promise<FileChangeQueueState> => {
    const { vault, hashStore } = state.options;

    // Load previous file hashes
    const previousHashes = await hashStore.load();

    // Get all markdown files in the vault
    const files = vault.getMarkdownFiles();

    // Calculate current hashes and detect changes
    const currentHashes: Record<string, string> = {};
    const newQueue: FileChange[] = [];

    // Process existing files
    for (const file of files) {
        const content = await vault.read(file);
        const hashFunc = state.options.hashFunc ?? calculateFileHash;
        const hash = await hashFunc(content);
        currentHashes[file.path] = hash;

        // Check if file is new or modified
        if (!previousHashes[file.path]) {
            newQueue.push({ path: file.path, reason: "new", hash });
        } else if (previousHashes[file.path] !== hash) {
            newQueue.push({ path: file.path, reason: "modified", hash });
        }
    }

    // Check for deleted files
    for (const path in previousHashes) {
        if (!currentHashes[path]) {
            newQueue.push({ path, reason: "deleted" });
        }
    }

    // Save current hashes
    await hashStore.save(currentHashes);

    // Update state in place
    state.queue = newQueue;
    state.fileHashes = currentHashes;

    // Register file change event callbacks
    const { eventRefs } = registerFileChangeCallbacks(state);
    state.eventRefs = eventRefs;

    return state;
};

/**
 * Registers callbacks for file change events in the Vault
 */
const registerFileChangeCallbacks = (
    state: FileChangeQueueState
): FileChangeQueueState => {
    const { vault } = state.options;

    // Clear any existing event refs
    for (const ref of state.eventRefs) {
        if (typeof ref === "function") {
            ref();
        }
    }

    const eventRefs: EventRef[] = [];

    // Register callback for file creation
    const createRef = vault.on("create", async (file: TFile) => {
        if (file.extension === "md") {
            const content = await vault.read(file);
            const hashFunc = state.options.hashFunc ?? calculateFileHash;
            const hash = await hashFunc(content);

            // Update file hashes
            state.fileHashes[file.path] = hash;

            // Add to queue with hash
            state.queue.push({ path: file.path, reason: "new" as const, hash });

            // Save updated hashes
            await state.options.hashStore.save(state.fileHashes);
        }
    });
    eventRefs.push(createRef);

    // Register callback for file modification
    const modifyRef = vault.on("modify", async (file: TFile) => {
        if (file.extension === "md") {
            const content = await vault.read(file);
            const hashFunc = state.options.hashFunc ?? calculateFileHash;
            const hash = await hashFunc(content);

            // Update file hashes
            state.fileHashes[file.path] = hash;

            // Add to queue with hash
            state.queue.push({
                path: file.path,
                reason: "modified" as const,
                hash,
            });

            // Save updated hashes
            await state.options.hashStore.save(state.fileHashes);
        }
    });
    eventRefs.push(modifyRef);

    // Register callback for file deletion
    const deleteRef = vault.on("delete", (file: TFile) => {
        if (file.extension === "md") {
            // Remove from file hashes
            delete state.fileHashes[file.path];

            // Add to queue (no hash for deleted files)
            state.queue.push({ path: file.path, reason: "deleted" as const });

            // Save updated hashes
            state.options.hashStore.save(state.fileHashes);
        }
    });
    eventRefs.push(deleteRef);

    return {
        ...state,
        eventRefs,
    };
};

/**
 * Unregisters all file change callbacks
 */
const unregisterFileChangeCallbacks = (
    state: FileChangeQueueState
): FileChangeQueueState => {
    // Clear all event refs
    for (const ref of state.eventRefs) {
        if (typeof ref === "function") {
            ref();
        }
    }

    return {
        ...state,
        eventRefs: [],
    };
};

/**
 * Cleans up the file change queue by unregistering all callbacks
 * This should be called when the queue is no longer needed
 */
export const cleanupFileChangeQueue = (
    state: FileChangeQueueState
): FileChangeQueueState => {
    return unregisterFileChangeCallbacks(state);
};

/**
 * Adds all files to the queue regardless of whether they've changed
 */
export const enqueueAllFiles = async (
    state: FileChangeQueueState
): Promise<FileChangeQueueState> => {
    const { vault } = state.options;

    // Get all markdown files in the vault
    const files = vault.getMarkdownFiles();

    // Add all files to the queue with their current hashes
    const newQueue: FileChange[] = [];

    for (const file of files) {
        const content = await vault.read(file);
        const hashFunc = state.options.hashFunc ?? calculateFileHash;
        const hash = await hashFunc(content);

        // Update file hashes
        state.fileHashes[file.path] = hash;

        newQueue.push({
            path: file.path,
            reason: "modified",
            hash,
        });
    }

    return {
        ...state,
        queue: newQueue,
    };
};

/**
 * Polls up to maxCount items from the queue
 * Items removed from the queue are considered processed
 *
 * Note: After processing each change, you should call markFileChangeProcessed
 * to ensure the hash store is updated, preventing reprocessing if the application
 * restarts before the hash store is updated.
 */
export const pollFileChanges = (
    state: FileChangeQueueState,
    maxCount: number
): {
    state: FileChangeQueueState;
    changes: FileChange[];
} => {
    const changes = state.queue.slice(0, maxCount);
    const newQueue = state.queue.slice(maxCount);

    return {
        state: {
            ...state,
            queue: newQueue,
        },
        changes,
    };
};

/**
 * Returns the number of changes remaining in the queue
 */
export const getFileChangeCount = (state: FileChangeQueueState): number => {
    return state.queue.length;
};

/**
 * Helper function to calculate a SHA-256 hash for a file's content
 */
export const calculateFileHash = async (content: string): Promise<string> => {
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
};

/**
 * Marks a file change as processed by updating the hash store
 * This should be called after processing a file change to ensure it's not reprocessed
 * if the application restarts before the hash store is updated
 */
export const markFileChangeProcessed = async (
    state: FileChangeQueueState,
    change: FileChange
): Promise<FileChangeQueueState> => {
    // Only update hash for new or modified files, not deleted ones
    if (change.reason !== "deleted" && change.hash) {
        // Update the hash store with the processed hash
        state.fileHashes[change.path] = change.hash;
        await state.options.hashStore.save(state.fileHashes);
    }

    return state;
};
