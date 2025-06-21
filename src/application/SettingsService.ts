import type { Plugin } from "obsidian";
import { type Observable, Subject } from "rxjs";

export interface SimilarNotesSettings {
    autoSaveInterval: number; // in minutes
    modelId: string; // The model ID to use for embeddings
    includeFrontmatter: boolean; // Whether to include frontmatter in indexing
    showSourceChunk: boolean; // Whether to show the original chunk in the results
}

const DEFAULT_SETTINGS: SimilarNotesSettings = {
    autoSaveInterval: 10,
    modelId: "sentence-transformers/all-MiniLM-L6-v2",
    includeFrontmatter: false,
    showSourceChunk: false,
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
