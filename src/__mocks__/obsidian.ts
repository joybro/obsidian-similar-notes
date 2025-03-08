// Mock minimal Obsidian types and interfaces needed for testing
export class TFile {
    path: string;
    basename: string;
    extension: string;

    constructor(path: string) {
        this.path = path;
        const parts = path.split(".");
        this.extension = parts.pop() || "";
        this.basename = parts.join(".");
    }
}

export interface App {
    workspace: {
        getLeaf: () => {
            openFile: (file: TFile) => Promise<void>;
        };
    };
}

// Add any other Obsidian types/interfaces as needed for tests
