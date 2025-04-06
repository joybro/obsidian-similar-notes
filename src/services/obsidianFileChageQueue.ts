import type { EventRef, TFile, Vault } from "obsidian";

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

    // Register file change event callbacks
    const newState = {
        ...state,
        queue: newQueue,
        fileHashes: currentHashes,
    };

    return registerFileChangeCallbacks(newState);
};

/**
 * Registers callbacks for file change events in the Vault
 */
export const registerFileChangeCallbacks = (
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

            // Add to queue
            state.queue.push({ path: file.path, reason: "new" });

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

            // Add to queue
            state.queue.push({ path: file.path, reason: "modified" });

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

            // Add to queue
            state.queue.push({ path: file.path, reason: "deleted" });

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
export const unregisterFileChangeCallbacks = (
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
