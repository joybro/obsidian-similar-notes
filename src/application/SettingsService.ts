import { Platform, type Plugin } from "obsidian";
import { type Observable, Subject } from "rxjs";

export interface CachedModelInfo {
    modelId: string;              // Which model this info belongs to
    parameterCount?: number;      // Total parameter count
    parameterSize?: string;       // Human-readable size (e.g., "22.7M")
    embeddingLength?: number;     // Embedding dimensions
    quantizationLevel?: string;   // Quantization level (for Ollama)
}

export type ModelProvider = "builtin" | "ollama" | "openai" | "gemini";
export const CURRENT_CODE_INDEX_VERSION = 1;

/**
 * Complete configuration for one embedding model. SimilarNotesSettings keeps
 * the existing note model fields at the top level for backwards compatibility,
 * while optional secondary models can use this nested shape.
 */
export interface EmbeddingModelSettings {
    modelProvider: ModelProvider;
    modelId: string;
    ollamaUrl?: string;
    ollamaModel?: string;
    openaiUrl?: string;
    openaiApiKey?: string;
    openaiModel?: string;
    openaiMaxTokens?: number;
    geminiApiKey?: string;
    geminiModel?: string;
    useGPU: boolean;
    cachedModelInfo?: CachedModelInfo;
}

export interface DailyUsage {
    tokens: number;
    requestCount: number;
}

export interface TotalUsage {
    tokens: number;
    requestCount: number;
    firstUseDate: string;
}

export interface UsageStats {
    daily: Record<string, DailyUsage>; // key: "YYYY-MM-DD"
    total: TotalUsage;
}

export interface SimilarNotesSettings extends EmbeddingModelSettings {
    openaiPricePerMillionTokens?: number; // Price per million tokens for cost estimation
    usageStats?: UsageStats; // API usage statistics
    codeModeEnabled: boolean; // Whether fenced code blocks are indexed separately
    codeModel?: EmbeddingModelSettings; // Independent embedding model for code blocks
    similarityMode: "notes" | "code"; // Active index for similar-note views
    codeIndexVersion: number; // Extraction/chunking schema used by persisted code vectors
    codeIndexFingerprint?: string; // Persisted Code vector schema/model identity
    includeFrontmatter: boolean; // Whether to include frontmatter in indexing
    showSourceChunk: boolean; // Whether to show the original chunk in the results
    excludeFolderPatterns: string[]; // Glob patterns to exclude folders/files from indexing
    excludeRegexPatterns: string[]; // Regular expressions to exclude content from indexing
    regexpTestInputText: string; // Saved test input for RegExp testing
    noteDisplayMode: "title" | "path" | "smart"; // How to display note names in results
    showAtBottom: boolean; // Whether to show similar notes at the bottom of notes
    sidebarResultCount: number; // Number of similar notes to show in sidebar
    bottomResultCount: number; // Number of similar notes to show at bottom of notes
    minSimilarityThreshold: number; // Hide results below this cosine similarity (0..1, 0 = no filtering)
    lastPluginVersion?: string; // Last version of the plugin that was run
    indexingDelaySeconds: number; // Wait time after file changes before indexing
    semanticLinkTrigger: string; // Editor prefix that opens semantic link suggestions ([[? alternative). Empty = disabled.
}

export const DEFAULT_EMBEDDING_MODEL_SETTINGS: Readonly<EmbeddingModelSettings> = {
    modelProvider: "builtin",
    modelId: "sentence-transformers/all-MiniLM-L6-v2",
    useGPU: true,
};

/** Create a detached model profile from the legacy top-level note settings. */
export function snapshotNoteModelSettings(
    settings: SimilarNotesSettings
): EmbeddingModelSettings {
    return {
        modelProvider: settings.modelProvider,
        modelId: settings.modelId,
        ollamaUrl: settings.ollamaUrl,
        ollamaModel: settings.ollamaModel,
        openaiUrl: settings.openaiUrl,
        openaiApiKey: settings.openaiApiKey,
        openaiModel: settings.openaiModel,
        openaiMaxTokens: settings.openaiMaxTokens,
        geminiApiKey: settings.geminiApiKey,
        geminiModel: settings.geminiModel,
        useGPU: settings.useGPU,
        cachedModelInfo: settings.cachedModelInfo
            ? { ...settings.cachedModelInfo }
            : undefined,
    };
}

/**
 * Fill fields omitted from a persisted nested profile without mutating either
 * the profile or its fallback.
 */
export function normalizeEmbeddingModelSettings(
    settings: Partial<EmbeddingModelSettings>,
    fallback: Readonly<EmbeddingModelSettings> = DEFAULT_EMBEDDING_MODEL_SETTINGS
): EmbeddingModelSettings {
    const normalized = { ...fallback, ...settings };
    return {
        ...normalized,
        cachedModelInfo: normalized.cachedModelInfo
            ? { ...normalized.cachedModelInfo }
            : undefined,
    };
}

const DEFAULT_SETTINGS: SimilarNotesSettings = {
    ...DEFAULT_EMBEDDING_MODEL_SETTINGS,
    codeModeEnabled: false,
    similarityMode: "notes",
    codeIndexVersion: CURRENT_CODE_INDEX_VERSION,
    includeFrontmatter: false,
    showSourceChunk: false,
    // Excalidraw/ holds drawings stored as base64-compressed JSON — binary data
    // that can't be embedded and isn't meaningful to index (#46). Only applies to
    // new installs; existing users' saved patterns are untouched by the merge.
    excludeFolderPatterns: ["Templates/", "Archive/", ".trash/", "Excalidraw/"], // Default exclusion patterns
    excludeRegexPatterns: [], // Default to no exclusion patterns
    regexpTestInputText: "", // Default to empty test input
    noteDisplayMode: "smart", // Default to smart mode (show path when duplicates exist)
    showAtBottom: true, // Show similar notes at the bottom by default
    sidebarResultCount: 10, // Default to 10 results in sidebar
    bottomResultCount: 5, // Default to 5 results at bottom
    minSimilarityThreshold: 0, // No filtering by default
    indexingDelaySeconds: 1, // Default to 1 second delay
    semanticLinkTrigger: ";;", // Default standalone trigger for semantic link suggestions
};

export class SettingsService {
    private settings: SimilarNotesSettings;
    private newSettingsObservable$ = new Subject<
        Partial<SimilarNotesSettings>
    >();

    constructor(private plugin: Plugin) {}

    async load(): Promise<void> {
        const data = (await this.plugin.loadData()) as
            | (Partial<Omit<SimilarNotesSettings, "codeModel">> & {
                  codeModel?: Partial<EmbeddingModelSettings>;
              })
            | null
            | undefined;
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...data,
            codeModel: data?.codeModel
                ? normalizeEmbeddingModelSettings(data.codeModel)
                : undefined,
        };

        // For new mobile installations, default to OpenAI provider
        // Built-in models can cause crashes on mobile devices
        if (!data && Platform.isMobileApp) {
            this.settings.modelProvider = "openai";
        }
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
