import type { SettingsService } from "@/application/SettingsService";
import {
    NoteChunk,
    isTitleChunk,
    titleFromPath,
    titleTextFromPath,
} from "@/domain/model/NoteChunk";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type { NoteChunkingService } from "@/domain/service/NoteChunkingService";
import type { ErroredNoteStore } from "@/infrastructure/ErroredNoteStore";
import type { NoteChange, NoteChangeQueue } from "@/infrastructure/noteChangeQueue";
import { showNoteErrorNotice } from "@/utils/errorHandling";
import { shouldExcludeByFrontmatter } from "@/utils/frontmatterExclusion";
import { applyExclusionPatterns } from "@/utils/indexableText";
import { computeIndexableTextHash } from "@/utils/indexableTextHash";
import log from "loglevel";
import type { App } from "obsidian";
import { type Observable, BehaviorSubject } from "rxjs";
import type { SimilarNoteCoordinator } from "./SimilarNoteCoordinator";

const MAX_ATTEMPTS = 3;

export class NoteIndexingService {
    private fileChangeLoopTimer: number | null = null;
    private noteChangeCount$: BehaviorSubject<number>;

    constructor(
        private noteRepository: NoteRepository,
        private noteChunkRepository: NoteChunkRepository,
        private noteChangeQueue: NoteChangeQueue,
        private noteChunkingService: NoteChunkingService,
        private embeddingService: EmbeddingService,
        private similarNoteCoordinator: SimilarNoteCoordinator,
        private settingsService: SettingsService,
        private app: App,
        private erroredNoteStore: ErroredNoteStore
    ) {
        // The queue is filled before this service exists, but the loop (which
        // republishes the count) starts only after the model is ready, possibly
        // after a long first download. Publish the startup count now so the
        // status bar and an empty panel know notes are waiting (QA sim8).
        this.noteChangeCount$ = new BehaviorSubject<number>(
            noteChangeQueue.getFileChangeCount()
        );
    }

    startLoop() {
        const fileChangeLoop = async () => {
            const count = this.noteChangeQueue.getFileChangeCount();
            this.noteChangeCount$.next(count);

            // Determine concurrency based on provider capability
            const supportsParallel = this.embeddingService.supportsParallelProcessing();
            const concurrency = supportsParallel ? 5 : 1;

            const changes = await this.noteChangeQueue.pollFileChanges(concurrency);
            if (changes.length === 0) {
                this.fileChangeLoopTimer = window.setTimeout(() => void fileChangeLoop(), 1000);
                return;
            }

            // Process files in parallel (or sequentially if concurrency=1)
            await Promise.allSettled(
                changes.map((change) => this.processChange(change))
            );

            fileChangeLoop();
        };

        fileChangeLoop();
    }

    /**
     * Processes a single change. On success the note is marked processed and any
     * prior errored entry is cleared; on failure it is routed through the
     * attempts machinery (retry, then terminal Errored). See indexing-status
     * spec §5/§6 — the failure routing must own ALL processing exceptions, so
     * nothing downstream may swallow them.
     */
    private async processChange(change: NoteChange): Promise<void> {
        log.info(`[NoteIndexingService] ===== Processing change: ${change.path} (${change.reason}) =====`);

        try {
            // Authoritative frontmatter-exclusion check (frontmatter-exclusion
            // spec §2). It runs here, not at event/queue time, because
            // metadataCache lags vault events — by processing time the cache
            // is warm. An excluded note ends up exactly like a path-excluded
            // one: no chunks, no mtime/hash metadata.
            if (
                change.reason !== "deleted" &&
                this.isFrontmatterExcluded(change.path)
            ) {
                log.info(
                    `[NoteIndexingService] ${change.path} is frontmatter-excluded, removing from index`
                );
                if (change.reason === "renamed" && change.oldPath) {
                    await this.noteChunkRepository.removeByPath(
                        change.oldPath
                    );
                    await this.noteChangeQueue.markNoteChangeProcessed({
                        path: change.oldPath,
                        reason: "deleted",
                    });
                }
                await this.removeIndexedChunksAndRefreshActiveNote(
                    change.path
                );
                await this.noteChangeQueue.markNoteChangeProcessed({
                    path: change.path,
                    reason: "deleted",
                });
                if (this.erroredNoteStore.get(change.path)) {
                    await this.erroredNoteStore.delete(change.path);
                }
                return;
            }

            let indexableTextHash: string | undefined;

            if (change.reason === "deleted") {
                await this.processDeletedNote(change.path);
            } else if (change.reason === "title-backfill") {
                await this.processTitleBackfill(change.path);
            } else if (change.reason === "renamed") {
                const result = await this.processRenamedNote(change);
                if (result === null) {
                    return;
                }
                indexableTextHash = result;
            } else {
                const result = await this.processUpdatedNote(
                    change.path,
                    change.forceReindex,
                    change.mtime
                );
                if (result === null) {
                    // The file vanished between queueing and processing (a
                    // delete event is on its way, or was lost). Do NOT write
                    // metadata: setMetadata here would erase the stored hash
                    // and keep a ghost "indexed" entry for a missing file.
                    return;
                }
                indexableTextHash = result;
            }

            // Success: mark processed and clear any prior errored entry.
            await this.noteChangeQueue.markNoteChangeProcessed(
                change,
                indexableTextHash
            );
            if (this.erroredNoteStore.get(change.path)) {
                await this.erroredNoteStore.delete(change.path);
            }
        } catch (error) {
            await this.handleChangeFailure(change, error);
        }
    }

    stopLoop() {
        if (this.fileChangeLoopTimer) {
            window.clearTimeout(this.fileChangeLoopTimer);
        }
    }

    /**
     * Handles a failed change: retry in-session up to MAX_ATTEMPTS, then move the
     * note to the terminal Errored state so it stops being re-queued (and the UI
     * can count it honestly). See indexing-status spec §3.
     */
    private async handleChangeFailure(
        change: NoteChange,
        error: unknown
    ): Promise<void> {
        const attempts = (change.attempts ?? 0) + 1;
        const message = error instanceof Error ? error.message : String(error);

        // Surface the failure to the user on its first occurrence. (Throttled
        // per-path inside showNoteErrorNotice; the durable record is the Errored
        // list once attempts reach MAX_ATTEMPTS.)
        if (attempts === 1) {
            showNoteErrorNotice(change.path, error);
        }

        if (attempts < MAX_ATTEMPTS) {
            log.warn(
                `[NoteIndexingService] Attempt ${attempts}/${MAX_ATTEMPTS} failed for ${change.path}, will retry`,
                error
            );
            this.noteChangeQueue.requeue({ ...change, attempts });
            return;
        }

        log.error(
            `[NoteIndexingService] Giving up on ${change.path} after ${attempts} attempts`,
            error
        );
        await this.erroredNoteStore.set(change.path, {
            error: message,
            attempts,
            mtime: change.mtime,
        });
    }

    /**
     * Queues a title-only embed for every note that has body chunks but no
     * title row (indexed before title rows existed). Called once after the
     * index is loaded from storage. See title-vector spec "Backfill".
     */
    async enqueueTitleBackfill(): Promise<void> {
        const paths = await this.noteChunkRepository.getPathsWithoutTitleChunk();
        if (paths.length === 0) return;
        log.info(
            `[NoteIndexingService] Queueing title backfill for ${paths.length} notes`
        );
        this.noteChangeQueue.enqueue(
            paths.map((path) => ({ path, reason: "title-backfill" as const }))
        );
    }

    getNoteChangeCount$(): Observable<number> {
        return this.noteChangeCount$.asObservable();
    }

    private async processDeletedNote(path: string) {
        await this.noteChunkRepository.removeByPath(path);
    }

    /**
     * Writes (or replaces) the title row of an indexed note, keeping its body
     * rows as they are. Body rows' `title` field is updated to the current
     * title as well, since a rename carries them with the old one.
     */
    private async replaceTitleChunk(path: string): Promise<void> {
        const rows = await this.noteChunkRepository.getByPath(path);
        // Body rows carry the basename as is (like Note.title); the title
        // row's text is trimmed, matching processUpdatedNote.
        const title = titleFromPath(path);
        const titleText = titleTextFromPath(path);
        const body = rows.filter((row) => !isTitleChunk(row));
        if (body.length === 0) {
            // The note was removed (or emptied) since it was queued.
            return;
        }
        const existingTitle = rows.find(isTitleChunk);
        const titleRowCurrent = titleText
            ? existingTitle?.content === titleText
            : existingTitle === undefined;
        if (titleRowCurrent && body.every((row) => row.title === title)) {
            return;
        }
        // Embed before touching the index, so a failed call leaves it as it was.
        const titleEmbedding = !titleText
            ? undefined
            : existingTitle && existingTitle.content === titleText
                ? existingTitle.embedding
                : (await this.embeddingService.embedTexts([titleText]))[0];
        await this.noteChunkRepository.removeByPath(path);
        await this.noteChunkRepository.putMulti([
            ...body.map(
                (row) =>
                    new NoteChunk(
                        row.path,
                        title,
                        row.content,
                        row.chunkIndex,
                        row.totalChunks,
                        row.embedding
                    )
            ),
            // A whitespace-only name gets no title row, as when indexing.
            ...(titleEmbedding
                ? [
                    NoteChunk.titleChunk(
                        path,
                        titleText,
                        body[0].totalChunks,
                        titleEmbedding
                    ),
                ]
                : []),
        ]);
    }

    private async processTitleBackfill(path: string): Promise<void> {
        await this.replaceTitleChunk(path);
    }

    /** Returns null when the file vanished before processing (do not mark). */
    private async processRenamedNote(
        change: NoteChange
    ): Promise<string | null | undefined> {
        const { oldPath, path: newPath } = change;
        if (!oldPath) {
            // Defensive: a "renamed" change without oldPath is malformed.
            // Treat it as a fresh embed of newPath rather than dropping it.
            log.warn(
                `[NoteIndexingService] Renamed change missing oldPath, falling back to full embed: ${newPath}`
            );
            return this.processUpdatedNote(
                newPath,
                change.forceReindex,
                change.mtime
            );
        }

        const carried = await this.noteChunkRepository.renamePath(
            oldPath,
            newPath
        );
        if (!carried) {
            // Old path had no chunks in the index (e.g. renamed before the
            // initial embed completed). Embed the new path from scratch.
            log.info(
                `[NoteIndexingService] No prior chunks for ${oldPath}, embedding ${newPath} fresh`
            );
            return this.processUpdatedNote(
                newPath,
                change.forceReindex,
                change.mtime
            );
        }

        log.info(
            `[NoteIndexingService] Carried embedding ${oldPath} -> ${newPath} without re-embedding`
        );

        // The title changes with the basename: re-embed only the title row.
        // A folder move keeps the basename, so nothing is re-embedded.
        if (titleFromPath(oldPath) !== titleFromPath(newPath)) {
            await this.replaceTitleChunk(newPath);
        }

        // If the renamed file is the currently active one, refresh the sidebar.
        this.refreshActiveNote(newPath);

        return undefined;
    }

    /** Returns null when the file vanished before processing (do not mark). */
    private async processUpdatedNote(
        path: string,
        forceReindex = false,
        changeMtime?: number
    ): Promise<string | null | undefined> {
        const note = await this.noteRepository.findByPath(
            path,
            !this.settingsService.get().includeFrontmatter
        );
        if (!note) {
            return null;
        }

        // Apply RegExp exclusion patterns before chunking. Shared with the
        // settings-tab tester so the preview matches what is hashed/embedded.
        const settings = this.settingsService.get();
        const filteredContent = applyExclusionPatterns(
            note.content ?? "",
            settings.excludeRegexPatterns || []
        );

        const indexableTextHash = await computeIndexableTextHash(
            filteredContent
        );
        const storedHash = await this.noteChangeQueue.getIndexableTextHash(
            path
        );

        if (!forceReindex && storedHash === indexableTextHash) {
            log.info(
                `[NoteIndexingService] Indexable text unchanged for ${path}, skipping re-embedding`
            );
            this.refreshActiveNoteMetadata(path, changeMtime);
            return indexableTextHash;
        }

        // The chunk index is about to be mutated: drop the stored hash first,
        // so a failed write below can never leave a hash that matches
        // previously-indexed content while its chunks are gone (a revert
        // would then hash-match and skip re-embedding a note that is absent
        // from search).
        await this.noteChangeQueue.clearIndexableTextHash(path);

        // Create a copy of the note with exactly the content used for hashing.
        const filteredNote = { ...note, content: filteredContent };

        if (!filteredContent) {
            await this.removeIndexedChunksAndRefreshActiveNote(note.path);
            return indexableTextHash;
        }

        const splitted = await this.noteChunkingService.split(filteredNote);
        if (splitted.length === 0) {
            await this.removeIndexedChunksAndRefreshActiveNote(note.path);
            return indexableTextHash;
        }

        log.info(`[NoteIndexingService] Generating embeddings for ${splitted.length} chunks (for indexing)`);

        // Prepare all texts for batch embedding
        const textsToEmbed = splitted.map((chunk) =>
            // Include title in first chunk to make it searchable
            chunk.chunkIndex === 0
                ? `${chunk.title}\n\n${chunk.content}`
                : chunk.content
        );

        // The title vector rides in the same batch, last (title-vector spec).
        // Derived from the path with the same helper rename and backfill use,
        // so all three write the same title text (trimmed basename).
        const title = titleTextFromPath(note.path);
        if (title) {
            textsToEmbed.push(title);
        }

        // Single batch API call for all chunks. A failure here MUST propagate to
        // processChange's catch → handleChangeFailure (retry, then terminal
        // Errored). Do NOT swallow it: swallowing made a failed note take the
        // success path and get recorded as Indexed with zero chunks (#45/#46).
        const embeddings = await this.embeddingService.embedTexts(textsToEmbed);

        // Map embeddings back to chunks by index
        const noteChunks = splitted.map((chunk, index) =>
            chunk.withEmbedding(embeddings[index])
        );
        if (title) {
            noteChunks.push(
                NoteChunk.titleChunk(
                    note.path,
                    title,
                    splitted.length,
                    embeddings[splitted.length]
                )
            );
        }

        log.info(`[NoteIndexingService] Successfully generated embeddings, saving to repository`);

        await this.noteChunkRepository.removeByPath(note.path);
        await this.noteChunkRepository.putMulti(noteChunks);

        log.info(
            `[NoteIndexingService] Saved ${noteChunks.length} chunks to repository. Total chunks in store:`,
            await this.noteChunkRepository.count()
        );

        // Only calculate similar notes if this is the currently active file
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.path === note.path) {
            log.info(`[NoteIndexingService] File is currently active, triggering similar note search`);
            this.refreshActiveNote(note.path);
        } else {
            log.info(`[NoteIndexingService] File is not currently active, skipping similar note search`);
        }

        return indexableTextHash;
    }

    private isFrontmatterExcluded(path: string): boolean {
        const rules =
            this.settingsService.get().excludeFrontmatterRules ?? [];
        if (rules.length === 0) return false;

        const file = this.app.vault.getFileByPath(path);
        if (!file) return false;

        return shouldExcludeByFrontmatter(
            this.app.metadataCache.getFileCache(file)?.frontmatter,
            rules
        );
    }

    private async removeIndexedChunksAndRefreshActiveNote(
        path: string
    ): Promise<void> {
        await this.noteChunkRepository.removeByPath(path);

        this.refreshActiveNote(path);
    }

    private refreshActiveNote(path: string): void {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.path !== path) {
            return;
        }

        void this.similarNoteCoordinator.emitNoteBottomViewModelFromPath(path);
    }

    private refreshActiveNoteMetadata(
        path: string,
        verifiedMtime?: number
    ): void {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.path !== path) {
            return;
        }

        void this.similarNoteCoordinator
            .refreshCachedNoteMetadataFromPath(path, verifiedMtime)
            .catch((error) =>
                log.warn(
                    `[NoteIndexingService] Failed to refresh cached metadata for ${path}`,
                    error
                )
            );
    }
}
