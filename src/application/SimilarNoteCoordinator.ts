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
import { logRejection } from "@/utils/logRejection";

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
// While the panel shows "Indexing your vault", search again at most this
// often as the queue drains. Each search may embed the open note on the fly
// (it is not indexed yet), so keep it low: about 6 per minute.
export const INDEXING_RESEARCH_INTERVAL_MS = 10_000;

export class SimilarNoteCoordinator {
    private noteBottomViewModel$ = new BehaviorSubject<NoteBottomViewModel>({
        currentFile: null,
        similarNoteEntries: [],
        // Before the first file-open is handled nothing has been searched.
        emptyReason: { kind: "loading" },
        noteDisplayMode: "title", // Will be properly initialized in constructor
        sidebarResultCount: 10,   // Will be properly initialized in constructor
        bottomResultCount: 5,     // Will be properly initialized in constructor
    });
    private cache = new Map<string, SimilarNoteCacheEntry>(); // file path -> entry
    // Notes still waiting to be indexed (the status bar's "N to index").
    private pendingIndexCount = 0;
    // How many of those queued changes are for a given path. The open note's
    // own queued edit never fills its own panel (it is not in its own
    // results), so only the others count toward the indexing line.
    private queuedCountFor: (path: string) => number = () => 0;
    // Throttle for re-searching while the panel shows the indexing line.
    private lastIndexingSearchAt = 0;
    private indexingSearchInFlight = false;
    // Set while the model is downloading or loading (ModelLoadGate): no
    // search runs and an empty panel shows this reason.
    private waitingReason: EmptyReason | null = null;

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
        this.publishDisplaySettings();

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
                        logRejection(this.emitNoteBottomViewModel(file), "refresh similar notes");
                        return;
                    }
                }

                this.publishDisplaySettings();
            });
    }

    // The three display settings every view model carries.
    private displaySettings() {
        const s = this.settingsService.get();
        return {
            noteDisplayMode: s.noteDisplayMode,
            sidebarResultCount: s.sidebarResultCount,
            bottomResultCount: s.bottomResultCount,
        };
    }

    private publishDisplaySettings() {
        const view = this.noteBottomViewModel$.value;
        this.noteBottomViewModel$.next({ ...view, ...this.displaySettings() });
    }

    /**
     * Follow the live count of notes waiting to be indexed (the status bar's
     * "N to index"), so an empty panel during indexing can say so instead of
     * "No similar notes found." Wired after the indexing service exists.
     *
     * While the panel shows the indexing line it searches again as the count
     * drops (throttled, INDEXING_RESEARCH_INTERVAL_MS), so results fill in as
     * notes are indexed, as the line promises, and once more when
     * the queue reaches zero. A plain "none" panel switches to the indexing
     * line when notes become queued (the open note may have been
     * searched before the first count was published).
     */
    watchPendingIndexCount(
        pendingIndexCount$: Observable<number>,
        queuedCountFor?: (path: string) => number
    ) {
        if (queuedCountFor) {
            this.queuedCountFor = queuedCountFor;
        }
        return pendingIndexCount$.subscribe((count) => {
            this.pendingIndexCount = count;
            const view = this.noteBottomViewModel$.value;
            const reason = view.emptyReason?.kind;
            if (!view.currentFile) {
                return;
            }
            // The panel's reason was computed when others were last 0
            // ("none") or positive ("indexing"), so it carries the previous
            // state.
            const others = this.pendingOtherThan(view.currentFile.path);
            if (reason === "none" && others > 0) {
                // The empty result was cached as final; drop it so the
                // searches below actually look again.
                this.cache.delete(view.currentFile.path);
                this.noteBottomViewModel$.next({
                    ...view,
                    emptyReason: { kind: "indexing", remaining: count },
                });
                return;
            }
            if (reason !== "indexing") {
                return;
            }
            if (others > 0) {
                this.noteBottomViewModel$.next({
                    ...view,
                    emptyReason: { kind: "indexing", remaining: count },
                });
                if (
                    Date.now() - this.lastIndexingSearchAt >=
                    INDEXING_RESEARCH_INTERVAL_MS
                ) {
                    void this.researchWhileIndexing(view.currentFile);
                }
            } else {
                // Indexing of the other notes finished while this note showed
                // the indexing line (the open note itself may still be
                // queued): search again now that the index is complete.
                void this.emitNoteBottomViewModel(view.currentFile);
            }
        });
    }

    private pendingOtherThan(path: string): number {
        return Math.max(0, this.pendingIndexCount - this.queuedCountFor(path));
    }

    // One throttled search while the indexing line shows; skipped while a
    // previous one is still running or the user has moved to another note.
    private async researchWhileIndexing(file: TFile) {
        if (this.indexingSearchInFlight) {
            return;
        }
        this.indexingSearchInFlight = true;
        try {
            await this.emitNoteBottomViewModel(file, {
                onlyIfStillCurrent: true,
            });
        } finally {
            this.indexingSearchInFlight = false;
        }
    }

    getNoteBottomViewModelObservable() {
        return this.noteBottomViewModel$.asObservable();
    }

    async onFileOpen(file: TFile | null) {
        if (!file || file.extension !== "md") {
            // No active markdown file — clear the sidebar so it doesn't keep
            // showing similar notes for a file the user has navigated away from.
            // No search ran, so "No similar notes found." would not be true.
            this.noteBottomViewModel$.next(this.emptyView(null, { kind: "no-note" }));
            return;
        }

        await this.emitNoteBottomViewModel(file);
    }

    private emptyView(
        file: TFile | null,
        emptyReason: EmptyReason
    ): NoteBottomViewModel {
        return {
            currentFile: file,
            similarNoteEntries: [],
            emptyReason,
            ...this.displaySettings(),
        };
    }

    /**
     * Called by ModelLoadGate. A reason holds searches and shows on an empty
     * waiting panel; null releases them and searches for the note opened
     * meanwhile. After a failed load the reason is the failure line: no
     * search runs, since the index was not opened and a search would throw.
     */
    setWaiting(reason: EmptyReason | null) {
        const heldFailure = this.waitingReason?.kind === "embedding-failed";
        const wasWaiting = this.waitingReason !== null;
        this.waitingReason = reason;
        const view = this.noteBottomViewModel$.value;
        const kind = view.emptyReason?.kind;
        // Only a line the gate put there is replaced; a search result stays.
        const gateFailure = kind === "embedding-failed" && heldFailure;
        if (kind !== "loading" && kind !== "downloading" && !gateFailure) {
            return;
        }
        if (reason) {
            this.noteBottomViewModel$.next({ ...view, emptyReason: reason });
        } else if (wasWaiting && view.currentFile) {
            logRejection(this.emitNoteBottomViewModel(view.currentFile), "search after model load");
        }
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

    async emitNoteBottomViewModel(
        file: TFile,
        options: { onlyIfStillCurrent?: boolean } = {}
    ) {
        // Any search restarts the indexing re-search throttle: the panel
        // just looked, so the next look waits a full interval.
        this.lastIndexingSearchAt = Date.now();
        if (this.waitingReason) {
            this.noteBottomViewModel$.next(this.emptyView(file, this.waitingReason));
            return;
        }
        const { notes, status } = await this.getSimilarNotesWithStatus(file);
        if (
            options.onlyIfStillCurrent &&
            this.noteBottomViewModel$.value.currentFile?.path !== file.path
        ) {
            return;
        }
        const settings = this.settingsService.get();
        const threshold = settings.minSimilarityThreshold;
        const filtered = notes.filter((entry) => entry.similarity >= threshold);
        this.noteBottomViewModel$.next({
            currentFile: file,
            similarNoteEntries: filtered,
            emptyReason:
                filtered.length > 0
                    ? undefined
                    : this.emptyReasonFor(
                        status,
                        notes.length,
                        threshold,
                        file.path
                    ),
            ...this.displaySettings(),
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
        threshold: number,
        path: string
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
        if (this.pendingOtherThan(path) > 0) {
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
        // read instead (frontmatter-exclusion spec §2.1).
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
            !(
                similarNoteEntries.length === 0 &&
                this.pendingOtherThan(file.path) > 0
            );
        if (cacheable) {
            this.cache.set(file.path, {
                mtime: file.stat.mtime,
                notes: similarNoteEntries,
                status,
            });
            if (this.cache.size > MAX_CACHE_SIZE) {
                const oldestKey = this.cache.keys().next().value as string | undefined;
                if (oldestKey !== undefined) this.cache.delete(oldestKey);
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
