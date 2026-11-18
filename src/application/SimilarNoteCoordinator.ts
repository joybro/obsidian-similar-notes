import type {
    EmptyReason,
    NoteBottomViewModel,
    SimilarNoteEntry,
} from "@/components/NoteBottomViewReact";
import type { NoteRepository } from "@/domain/repository/NoteRepository";
import { Note } from "@/domain/model/Note";
import type {
    SimilarNoteFinder,
    SimilarNoteSearchStatus,
} from "@/domain/service/SimilarNoteFinder";
import { applyExclusionPatterns } from "@/utils/indexableText";
import log from "loglevel";
import type { TFile, Vault } from "obsidian";
import { BehaviorSubject, type Observable } from "rxjs";
import type { SettingsService } from "./SettingsService";

interface SimilarNoteCacheEntry {
    mtime: number;
    notes: SimilarNoteEntry[];
    status: SimilarNoteSearchStatus;
}

interface SimilarNotesWithStatus {
    notes: SimilarNoteEntry[];
    status: SimilarNoteSearchStatus;
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
    // Notes still waiting to be indexed (the status bar's "N to index").
    private pendingIndexCount = 0;

    constructor(
        private readonly vault: Vault,
        private readonly noteRepository: NoteRepository,
        private readonly similarNoteFinder: SimilarNoteFinder,
        private readonly settingsService: SettingsService,
        // Whether a note is excluded from the index (path patterns or
        // frontmatter rules). Defaults to "never" for callers/tests that
        // don't care about exclusion.
        private readonly isExcluded: (path: string) => boolean = () => false
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

    /**
     * Follow the live count of notes waiting to be indexed (the status bar's
     * "N to index"), so an empty panel during indexing can say so instead of
     * "No similar notes found." Wired after the indexing service exists.
     */
    watchPendingIndexCount(pendingIndexCount$: Observable<number>) {
        return pendingIndexCount$.subscribe((count) => {
            const wasPending = this.pendingIndexCount > 0;
            this.pendingIndexCount = count;
            const view = this.noteBottomViewModel$.value;
            if (view.emptyReason?.kind !== "indexing" || !view.currentFile) {
                return;
            }
            if (count > 0) {
                this.noteBottomViewModel$.next({
                    ...view,
                    emptyReason: { kind: "indexing", remaining: count },
                });
            } else if (wasPending) {
                // Indexing finished while this note showed the indexing
                // line: search again now that the index is complete.
                void this.emitNoteBottomViewModel(view.currentFile);
            }
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
                status: cached.status,
            });

            const latestView = this.noteBottomViewModel$.value;
            if (latestView.currentFile?.path === file.path) {
                const threshold = settings.minSimilarityThreshold;
                this.noteBottomViewModel$.next({
                    ...latestView,
                    similarNoteEntries: this.withoutExcludedTargets(
                        updatedNotes
                    ).filter((entry) => entry.similarity >= threshold),
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
            similarNoteEntries: this.withoutExcludedTargets(
                updateLinks(latestView.similarNoteEntries)
            ),
        });
        return true;
    }

    async emitNoteBottomViewModel(file: TFile) {
        const { notes, status } = await this.getSimilarNotesWithStatus(file);
        const settings = this.settingsService.get();
        const threshold = settings.minSimilarityThreshold;
        const filtered = notes.filter((entry) => entry.similarity >= threshold);
        this.noteBottomViewModel$.next({
            currentFile: file,
            similarNoteEntries: filtered,
            emptyReason:
                filtered.length > 0
                    ? undefined
                    : this.emptyReasonFor(status, notes.length, threshold),
            noteDisplayMode: settings.noteDisplayMode,
            sidebarResultCount: settings.sidebarResultCount,
            bottomResultCount: settings.bottomResultCount,
        });
    }

    /**
     * Why the panel is empty (panel-empty-states spec). Order matters: a
     * search that never ran explains itself first; "indexing" only when the
     * search ran and found nothing while notes are still queued; the
     * threshold only when it hid results that exist.
     */
    private emptyReasonFor(
        status: SimilarNoteSearchStatus,
        rawCount: number,
        threshold: number
    ): EmptyReason {
        if (status === "empty-content") {
            return { kind: "unwritten" };
        }
        if (status === "ad-hoc-disallowed") {
            const provider = this.settingsService.get().modelProvider;
            return {
                kind: "excluded-cloud",
                provider: provider === "gemini" ? "Gemini" : "OpenAI",
            };
        }
        if (status === "embedding-failed") {
            return { kind: "embedding-failed" };
        }
        if (rawCount > 0) {
            return { kind: "below-threshold", threshold };
        }
        if (this.pendingIndexCount > 0) {
            return { kind: "indexing", remaining: this.pendingIndexCount };
        }
        return { kind: "none" };
    }

    async getSimilarNotes(file: TFile): Promise<SimilarNoteEntry[]> {
        return (await this.getSimilarNotesWithStatus(file)).notes;
    }

    private async getSimilarNotesWithStatus(
        file: TFile
    ): Promise<SimilarNotesWithStatus> {
        const settings = this.settingsService.get();
        // Excluded notes have no indexed chunks, so opening one would embed
        // its text on the fly. With a cloud provider that sends it off the
        // device, which the user opted out of by excluding it
        // (frontmatter-exclusion spec §2.1). Local providers keep the panel.
        const isCloudProvider =
            settings.modelProvider === "openai" ||
            settings.modelProvider === "gemini";
        const allowAdHocEmbedding = !(
            isCloudProvider && this.isExcluded(file.path)
        );

        // The cache is keyed on the source's mtime only, so an exclusion
        // applied after caching (path pattern saved, frontmatter rule matched
        // on another note) does not invalidate it. Re-check exclusion on every
        // read instead (frontmatter-exclusion spec §2.1, QA sim6).
        const cacheEntry = this.cache.get(file.path);
        if (
            cacheEntry &&
            cacheEntry.mtime === file.stat.mtime &&
            allowAdHocEmbedding
        ) {
            return {
                notes: this.withoutExcludedTargets(cacheEntry.notes),
                status: cacheEntry.status,
            };
        }

        const rawNote = await this.noteRepository.findByFile(
            file,
            !settings.includeFrontmatter
        );
        // When the note has no indexed chunks (not yet indexed, or excluded
        // from the index), the finder embeds this content on the fly — for a
        // remote provider that means sending it to the API. Strip
        // regex-excluded content first so the query side never embeds text
        // the index side would have removed (frontmatter-exclusion spec §2.1).
        const note = new Note(
            rawNote.path,
            rawNote.title,
            applyExclusionPatterns(
                rawNote.content ?? "",
                settings.excludeRegexPatterns || []
            ),
            rawNote.links
        );
        const maxResultCount = Math.max(settings.sidebarResultCount, settings.bottomResultCount);
        const { notes: similarNotes, status } =
            await this.similarNoteFinder.findSimilarNotesWithStatus(
                note,
                maxResultCount,
                { allowAdHocEmbedding }
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

        // Don't cache a failed embedding (reopening the note should retry, as
        // the panel tells the user) or an empty search while notes are still
        // being indexed (results fill in as indexing progresses).
        // Nor a skipped search for an excluded note: the cache is bypassed
        // while it stays excluded, and once included again it must search.
        const cacheable =
            status !== "embedding-failed" &&
            status !== "ad-hoc-disallowed" &&
            !(similarNoteEntries.length === 0 && this.pendingIndexCount > 0);
        if (cacheable) {
            this.cache.set(file.path, {
                mtime: file.stat.mtime,
                notes: similarNoteEntries,
                status,
            });
            if (this.cache.size > MAX_CACHE_SIZE) {
                const oldestKey = this.cache.keys().next().value;
                this.cache.delete(oldestKey);
            }
        }

        return {
            notes: this.withoutExcludedTargets(similarNoteEntries),
            status,
        };
    }

    // A target excluded after its chunks were indexed can still come back
    // from the finder until the index removal lands, and from the cache
    // afterwards. Filter both so excluded notes never appear as results.
    private withoutExcludedTargets(
        entries: SimilarNoteEntry[]
    ): SimilarNoteEntry[] {
        return entries.filter((entry) => !this.isExcluded(entry.file.path));
    }
}
