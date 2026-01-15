import type { Plugin } from "obsidian";
import { type Observable, Subject } from "rxjs";

export interface CachedModelInfo {
    modelId: string;              // Which model this info belongs to
    parameterCount?: number;      // Total parameter count
    parameterSize?: string;       // Human-readable size (e.g., "22.7M")
    embeddingLength?: number;     // Embedding dimensions
    quantizationLevel?: string;   // Quantization level (for Ollama)
}

export interface SimilarNotesSettings {
    modelProvider: "builtin" | "ollama"; // Model provider type
    modelId: string; // The model ID to use for embeddings
    ollamaUrl?: string; // Ollama server URL
    ollamaModel?: string; // Ollama model name
    includeFrontmatter: boolean; // Whether to include frontmatter in indexing
    showSourceChunk: boolean; // Whether to show the original chunk in the results
    useGPU: boolean; // Whether to use GPU acceleration for model inference
    excludeFolderPatterns: string[]; // Glob patterns to exclude folders/files from indexing
    excludeRegexPatterns: string[]; // Regular expressions to exclude content from indexing
    regexpTestInputText: string; // Saved test input for RegExp testing
    noteDisplayMode: "title" | "path" | "smart"; // How to display note names in results
    showAtBottom: boolean; // Whether to show similar notes at the bottom of notes
    sidebarResultCount: number; // Number of similar notes to show in sidebar
    bottomResultCount: number; // Number of similar notes to show at bottom of notes
    lastPluginVersion?: string; // Last version of the plugin that was run
    cachedModelInfo?: CachedModelInfo; // Cached model information
}

const DEFAULT_SETTINGS: SimilarNotesSettings = {
    modelProvider: "builtin", // Default to built-in models
    modelId: "sentence-transformers/all-MiniLM-L6-v2",
    includeFrontmatter: false,
    showSourceChunk: false,
    useGPU: true, // Use GPU acceleration by default
    excludeFolderPatterns: ["Templates/", "Archive/", ".trash/"], // Default exclusion patterns
    excludeRegexPatterns: [], // Default to no exclusion patterns
    regexpTestInputText: "", // Default to empty test input
    noteDisplayMode: "title", // Default to showing title only
    showAtBottom: true, // Show similar notes at the bottom by default
    sidebarResultCount: 10, // Default to 10 results in sidebar
    bottomResultCount: 5, // Default to 5 results at bottom
};

export class SettingsService {
    private settings: SimilarNotesSettings;
    private newSettingsObservable$ = new Subject<
        Partial<SimilarNotesSettings>
    >();

    constructor(private plugin: Plugin) {}

    async load(): Promise<void> {
        const data = await this.plugin.loadData();
        this.settings = { ...DEFAULT_SETTINGS, ...data };
    }

    async save(): Promise<void> {
        await this.plugin.saveData(this.settings);
    }

    get(): SimilarNotesSettings {
        return this.settings;
    }

    getNewSettingsObservable(): Observable<Partial<SimilarNotesSettings>> {
        return this.newSettingsObservable$.asObservable();
    }

    async update(newSettings: Partial<SimilarNotesSettings>): Promise<void> {
        this.settings = { ...this.settings, ...newSettings };
        await this.save();

        this.newSettingsObservable$.next(newSettings);
    }
}
