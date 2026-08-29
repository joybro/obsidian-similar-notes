import type {
    NoteBottomViewModel,
    SimilarNoteEntry,
} from "@/components/NoteBottomViewReact";
import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { SimilarNoteFinder } from "@/domain/service/SimilarNoteFinder";
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
    });
    private cache = new Map<string, SimilarNoteCacheEntry>(); // file path -> entry

    constructor(
        private readonly vault: Vault,
        private readonly noteRepository: NoteRepository,
        private readonly similarNoteFinder: SimilarNoteFinder,
        private readonly settingsService: SettingsService
    ) {
        // Initialize with current settings
        const settings = this.settingsService.get();
        const currentModel = this.noteBottomViewModel$.value;
        this.noteBottomViewModel$.next({
            ...currentModel,
            noteDisplayMode: settings.noteDisplayMode,
            sidebarResultCount: settings.sidebarResultCount,
            bottomResultCount: settings.bottomResultCount,
        });

        this.settingsService
            .getNewSettingsObservable()
            .subscribe((newSettings) => {
                if (newSettings.includeFrontmatter !== undefined) {
                    this.cache.clear();
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
                });
            });
    }

    getNoteBottomViewModelObservable() {
        return this.noteBottomViewModel$.asObservable();
    }

    async onFileOpen(file: TFile | null) {
        if (!file || file.extension !== "md") {
            // No active markdown file — clear the sidebar so it doesn't keep
            // showing similar notes for a file the user has navigated away from.
            const settings = this.settingsService.get();
            this.noteBottomViewModel$.next({
                currentFile: null,
                similarNoteEntries: [],
                noteDisplayMode: settings.noteDisplayMode,
                sidebarResultCount: settings.sidebarResultCount,
                bottomResultCount: settings.bottomResultCount,
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

        await this.emitNoteBottomViewModel(file);
    }

    /**
     * Refresh metadata derived from the active note without repeating vector
     * search. Used when indexing proves the effective embedding text is
     * unchanged but excluded content may have changed links.
     *
     * @param verifiedMtime The stat mtime of the change whose content was
     * hash-verified as unchanged. The cache is stamped with THIS mtime, never
     * the live stat: a real edit landing between the hash check and this
     * refresh would otherwise mark the pre-edit results fresh for the new
     * mtime, and getSimilarNotes would keep serving them after re-embedding.
     */
    async refreshCachedNoteMetadataFromPath(
        path: string,
        verifiedMtime?: number
    ): Promise<boolean> {
        const file = this.vault.getFileByPath(path);
        if (!file) {
            return false;
        }

        const settings = this.settingsService.get();
        const cacheKey = file.path;
        const currentView = this.noteBottomViewModel$.value;
        if (
            !this.cache.has(cacheKey) &&
            currentView.currentFile?.path !== file.path
        ) {
            return false;
        }

        // Only the resolved links are needed — no file content read.
        const linkedPaths = new Set(
            await this.noteRepository.getLinkedPaths(file.path)
        );
        const updateLinks = (entries: SimilarNoteEntry[]) =>
            entries.map((entry) => ({
                ...entry,
                isLinked: linkedPaths.has(entry.file.path),
            }));

        const cached = this.cache.get(cacheKey);
        if (cached) {
            const updatedNotes = updateLinks(cached.notes);
            this.cache.set(cacheKey, {
                mtime: verifiedMtime ?? cached.mtime,
                notes: updatedNotes,
            });

            const latestView = this.noteBottomViewModel$.value;
            if (latestView.currentFile?.path === file.path) {
                const threshold = settings.minSimilarityThreshold;
                this.noteBottomViewModel$.next({
                    ...latestView,
                    similarNoteEntries: updatedNotes.filter(
                        (entry) => entry.similarity >= threshold
                    ),
                });
            }
            return true;
        }

        const latestView = this.noteBottomViewModel$.value;
        if (latestView.currentFile?.path !== file.path) {
            return false;
        }
        this.noteBottomViewModel$.next({
            ...latestView,
            similarNoteEntries: updateLinks(latestView.similarNoteEntries),
        });
        return true;
    }

    async emitNoteBottomViewModel(file: TFile) {
        const similarNotes = await this.getSimilarNotes(file);
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
        });
    }

    async getSimilarNotes(file: TFile): Promise<SimilarNoteEntry[]> {
        const cacheEntry = this.cache.get(file.path);
        if (cacheEntry && cacheEntry.mtime === file.stat.mtime) {
            return cacheEntry.notes;
        }

        const settings = this.settingsService.get();
        const note = await this.noteRepository.findByFile(
            file,
            !settings.includeFrontmatter
        );
        const maxResultCount = Math.max(settings.sidebarResultCount, settings.bottomResultCount);
        const similarNotes = await this.similarNoteFinder.findSimilarNotes(
            note,
            maxResultCount
        );

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

        this.cache.set(file.path, {
            mtime: file.stat.mtime,
            notes: similarNoteEntries,
        });
        if (this.cache.size > MAX_CACHE_SIZE) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        return similarNoteEntries;
    }
}
