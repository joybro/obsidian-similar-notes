import type { Vault } from "obsidian";

export type FileChange = {
    path: string;
    reason: "new" | "modified" | "deleted";
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
            newQueue.push({ path: file.path, reason: "new" });
        } else if (previousHashes[file.path] !== hash) {
            newQueue.push({ path: file.path, reason: "modified" });
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

    return {
        ...state,
        queue: newQueue,
        fileHashes: currentHashes,
    };
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

    // Add all files to the queue
    const newQueue: FileChange[] = files.map((file) => ({
        path: file.path,
        reason: "modified",
    }));

    return {
        ...state,
        queue: newQueue,
    };
};

/**
 * Polls up to maxCount items from the queue
 * Items removed from the queue are considered processed
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
 * Helper function to calculate a hash for a file's content
 */
const calculateFileHash = async (content: string): Promise<string> => {
    // Simple hash function for demonstration
    // In a real implementation, you might want to use a more robust hashing algorithm
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
};
