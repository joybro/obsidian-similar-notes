import type {
    NoteBottomViewModel,
    SimilarNoteEntry,
} from "@/components/NoteBottomViewReact";
import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { SimilarNoteFinder } from "@/domain/service/SimilarNoteFinder";
import type { TextSearch } from "@/domain/service/TextSearchService";
import type { SearchMode } from "@/domain/model/SearchMode";
import { AsyncOperationGate } from "@/utils/AsyncOperationGate";
import log from "loglevel";
import type { TFile, Vault } from "obsidian";
import { BehaviorSubject } from "rxjs";
import type { SettingsService } from "./SettingsService";

interface SimilarNoteCacheEntry {
    mtime: number;
    notes: SimilarNoteEntry[];
}

const MAX_CACHE_SIZE = 20;

export class SimilarNoteCoordinator {
    private noteBottomViewModel$ = new BehaviorSubject<NoteBottomViewModel>({
        currentFile: null,
        similarNoteEntries: [],
        noteDisplayMode: "title", // Will be properly initialized in constructor
        sidebarResultCount: 10,   // Will be properly initialized in constructor
        bottomResultCount: 5,     // Will be properly initialized in constructor
        searchMode: "notes",
        codeModeEnabled: false,
    });
    private cache = new Map<string, SimilarNoteCacheEntry>(); // file path -> entry
    private viewRequestId = 0;
    private readonly searchGates: Record<SearchMode, AsyncOperationGate> = {
        notes: new AsyncOperationGate(),
        code: new AsyncOperationGate(),
    };

    constructor(
        private readonly vault: Vault,
        private readonly noteRepository: NoteRepository,
        private readonly similarNoteFinder: SimilarNoteFinder,
        private readonly settingsService: SettingsService,
        private codeSimilarNoteFinder?: SimilarNoteFinder
    ) {
        // Initialize with current settings
        const settings = this.settingsService.get();
        const currentModel = this.noteBottomViewModel$.value;
        this.noteBottomViewModel$.next({
            ...currentModel,
            noteDisplayMode: settings.noteDisplayMode,
            sidebarResultCount: settings.sidebarResultCount,
            bottomResultCount: settings.bottomResultCount,
            searchMode: this.getSearchMode(),
            codeModeEnabled: settings.codeModeEnabled,
        });

        this.settingsService
            .getNewSettingsObservable()
            .subscribe((newSettings) => {
                if (newSettings.includeFrontmatter !== undefined) {
                    this.cache.clear();
                }

                if (
                    newSettings.codeModeEnabled !== undefined ||
                    newSettings.similarityMode !== undefined ||
                    newSettings.codeModel !== undefined
                ) {
                    this.cache.clear();
                    const file = this.noteBottomViewModel$.value.currentFile;
                    if (file) {
                        void this.emitNoteBottomViewModel(file);
                        return;
                    }
                }

                // Clear cache if result count settings changed (need to fetch more/fewer results)
                if (newSettings.sidebarResultCount !== undefined || newSettings.bottomResultCount !== undefined) {
                    this.cache.clear();
                }

                // Threshold is a display-time filter, not part of the cached
                // raw results — re-emit the current file's view so the new
                // threshold is applied without re-running the search.
                if (newSettings.minSimilarityThreshold !== undefined) {
                    const file = this.noteBottomViewModel$.value.currentFile;
                    if (file) {
                        this.emitNoteBottomViewModel(file);
                        return;
                    }
                }

                // Update current model with new settings
                const settings = this.settingsService.get();
                const currentModel = this.noteBottomViewModel$.value;
                this.noteBottomViewModel$.next({
                    ...currentModel,
                    noteDisplayMode: settings.noteDisplayMode,
                    sidebarResultCount: settings.sidebarResultCount,
                    bottomResultCount: settings.bottomResultCount,
                    searchMode: this.getSearchMode(),
                    codeModeEnabled: settings.codeModeEnabled,
                });
            });
    }

    setCodeSimilarNoteFinder(finder: SimilarNoteFinder | undefined): void {
        this.codeSimilarNoteFinder = finder;
        this.cache.clear();
        const file = this.noteBottomViewModel$.value.currentFile;
        if (finder && file && this.getSearchMode() === "code") {
            void this.emitNoteBottomViewModel(file);
        }
    }

    async runSearchOperation<T>(
        mode: SearchMode,
        operation: () => Promise<T>
    ): Promise<T> {
        return await this.searchGates[mode].run(operation);
    }

    async runSearchTransition<T>(
        mode: SearchMode,
        operation: () => Promise<T>
    ): Promise<T> {
        return await this.searchGates[mode].transition(operation);
    }

    async closeSearchMode<T>(
        mode: SearchMode,
        operation: () => Promise<T>
    ): Promise<T> {
        return await this.searchGates[mode].close(
            operation,
            new Error(`${mode} search is unavailable because the plugin unloaded`)
        );
    }

    coordinateTextSearch(mode: SearchMode, service: TextSearch): TextSearch {
        return {
            checkTokenLimit: (text) =>
                this.runSearchOperation(mode, () =>
                    service.checkTokenLimit(text)
                ),
            findSimilarNotesFromText: (text, limit) =>
                this.runSearchOperation(mode, () =>
                    service.findSimilarNotesFromText(text, limit)
                ),
        };
    }

    getSearchMode(): SearchMode {
        const settings = this.settingsService.get();
        if (!settings.codeModeEnabled) {
            return "notes";
        }
        return settings.similarityMode ?? "notes";
    }

    async setSearchMode(mode: SearchMode): Promise<void> {
        const settings = this.settingsService.get();
        const nextMode = settings.codeModeEnabled ? mode : "notes";
        if (this.getSearchMode() === nextMode) {
            return;
        }

        await this.settingsService.update({ similarityMode: nextMode });
    }

    getNoteBottomViewModelObservable() {
        return this.noteBottomViewModel$.asObservable();
    }

    async onFileOpen(file: TFile | null) {
        if (!file || file.extension !== "md") {
            this.viewRequestId += 1;
            // No active markdown file — clear the sidebar so it doesn't keep
            // showing similar notes for a file the user has navigated away from.
            const settings = this.settingsService.get();
            this.noteBottomViewModel$.next({
                currentFile: null,
                similarNoteEntries: [],
                noteDisplayMode: settings.noteDisplayMode,
                sidebarResultCount: settings.sidebarResultCount,
                bottomResultCount: settings.bottomResultCount,
                searchMode: this.getSearchMode(),
                codeModeEnabled: settings.codeModeEnabled,
            });
            return;
        }

        await this.emitNoteBottomViewModel(file);
    }

    async emitNoteBottomViewModelFromPath(path: string) {
        const file = this.vault.getFileByPath(path);
        if (!file) {
            return;
        }

        for (const key of this.cache.keys()) {
            if (key.startsWith(`${path}:`)) {
                this.cache.delete(key);
            }
        }
        await this.emitNoteBottomViewModel(file);
    }

    async emitNoteBottomViewModel(file: TFile) {
        const requestId = ++this.viewRequestId;
        const mode = this.getSearchMode();
        const similarNotes = await this.getSimilarNotes(file, mode);
        if (requestId !== this.viewRequestId || mode !== this.getSearchMode()) {
            return;
        }
        const settings = this.settingsService.get();
        const filtered = similarNotes.filter(
            (entry) => entry.similarity >= settings.minSimilarityThreshold
        );
        this.noteBottomViewModel$.next({
            currentFile: file,
            similarNoteEntries: filtered,
            noteDisplayMode: settings.noteDisplayMode,
            sidebarResultCount: settings.sidebarResultCount,
            bottomResultCount: settings.bottomResultCount,
            searchMode: mode,
            codeModeEnabled: settings.codeModeEnabled,
        });
    }

    async getSimilarNotes(
        file: TFile,
        mode: SearchMode = "notes"
    ): Promise<SimilarNoteEntry[]> {
        const settings = this.settingsService.get();
        const effectiveMode =
            mode === "code" && settings.codeModeEnabled ? "code" : "notes";
        return await this.runSearchOperation(effectiveMode, () =>
            this.getSimilarNotesForMode(file, effectiveMode)
        );
    }

    private async getSimilarNotesForMode(
        file: TFile,
        effectiveMode: SearchMode
    ): Promise<SimilarNoteEntry[]> {
        const settings = this.settingsService.get();
        const profileKey = this.getProfileCacheKey(effectiveMode);
        const cacheKey = `${file.path}:${effectiveMode}:${profileKey}`;
        const cacheEntry = this.cache.get(cacheKey);
        if (cacheEntry && cacheEntry.mtime === file.stat.mtime) {
            return cacheEntry.notes;
        }

        const note = await this.noteRepository.findByFile(
            file,
            !settings.includeFrontmatter
        );
        const maxResultCount = Math.max(settings.sidebarResultCount, settings.bottomResultCount);
        const finder =
            effectiveMode === "code"
                ? this.codeSimilarNoteFinder
                : this.similarNoteFinder;
        const similarNotes = finder
            ? await finder.findSimilarNotes(
                note,
                maxResultCount
            )
            : [];

        const showSourceChunk = settings.showSourceChunk;

        const similarNoteEntries = similarNotes
            .map((similarNote) => ({
                file: this.vault.getFileByPath(similarNote.path),
                title: similarNote.title,
                similarity: similarNote.similarity,
                preview: similarNote.similarChunk,
                sourceChunk: showSourceChunk
                    ? similarNote.sourceChunk
                    : undefined,
                isLinked: similarNote.isLinked,
                path: similarNote.path,
            }))
            .filter((viewModel) => {
                if (viewModel.file === null) {
                    log.error(
                        `Stale data detected: similar note not found in vault (path: ${viewModel.path}). ` +
                        `This may indicate the file was renamed/moved but the index was not updated.`
                    );
                    return false;
                }
                return true;
            })
            .map(({ path: _path, ...rest }) => rest) as SimilarNoteEntry[];

        this.cache.set(cacheKey, {
            mtime: file.stat.mtime,
            notes: similarNoteEntries,
        });
        if (this.cache.size > MAX_CACHE_SIZE) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        return similarNoteEntries;
    }

    private getProfileCacheKey(mode: SearchMode): string {
        const settings = this.settingsService.get();
        const profile = mode === "code" ? settings.codeModel : settings;
        if (!profile) {
            return "unconfigured";
        }

        const model =
            profile.modelProvider === "builtin"
                ? profile.modelId
                : profile.modelProvider === "ollama"
                    ? profile.ollamaModel
                    : profile.modelProvider === "openai"
                        ? profile.openaiModel
                        : profile.geminiModel;
        return [profile.modelProvider, model ?? "", profile.openaiMaxTokens ?? ""]
            .join(":");
    }
}
