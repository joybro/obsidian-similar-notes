import type { SettingsService } from "@/application/SettingsService";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type { NoteChunkingService } from "@/domain/service/NoteChunkingService";
import type { ErroredNoteStore } from "@/infrastructure/ErroredNoteStore";
import type { NoteChange, NoteChangeQueue } from "@/services/noteChangeQueue";
import { showNoteErrorNotice } from "@/utils/errorHandling";
import log from "loglevel";
import type { App } from "obsidian";
import { type Observable, BehaviorSubject } from "rxjs";
import type { SimilarNoteCoordinator } from "./SimilarNoteCoordinator";

const MAX_ATTEMPTS = 3;

export class NoteIndexingService {
    private fileChangeLoopTimer: NodeJS.Timeout | null = null;
    private noteChangeCount$ = new BehaviorSubject<number>(0);

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
    ) {}

    startLoop() {
        const fileChangeLoop = async () => {
            const count = this.noteChangeQueue.getFileChangeCount();
            this.noteChangeCount$.next(count);

            // Determine concurrency based on provider capability
            const supportsParallel = this.embeddingService.supportsParallelProcessing();
            const concurrency = supportsParallel ? 5 : 1;

            const changes = await this.noteChangeQueue.pollFileChanges(concurrency);
            if (changes.length === 0) {
                this.fileChangeLoopTimer = setTimeout(fileChangeLoop, 1000);
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
            if (change.reason === "deleted") {
                await this.processDeletedNote(change.path);
            } else if (change.reason === "renamed") {
                await this.processRenamedNote(change);
            } else {
                await this.processUpdatedNote(change.path);
            }

            // Success: mark processed and clear any prior errored entry.
            await this.noteChangeQueue.markNoteChangeProcessed(change);
            if (this.erroredNoteStore.get(change.path)) {
                await this.erroredNoteStore.delete(change.path);
            }
        } catch (error) {
            await this.handleChangeFailure(change, error);
        }
    }

    stopLoop() {
        if (this.fileChangeLoopTimer) {
            clearTimeout(this.fileChangeLoopTimer);
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

    getNoteChangeCount$(): Observable<number> {
        return this.noteChangeCount$.asObservable();
    }

    private async processDeletedNote(path: string) {
        await this.noteChunkRepository.removeByPath(path);
    }

    private async processRenamedNote(change: NoteChange) {
        const { oldPath, path: newPath } = change;
        if (!oldPath) {
            // Defensive: a "renamed" change without oldPath is malformed.
            // Treat it as a fresh embed of newPath rather than dropping it.
            log.warn(
                `[NoteIndexingService] Renamed change missing oldPath, falling back to full embed: ${newPath}`
            );
            await this.processUpdatedNote(newPath);
            return;
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
            await this.processUpdatedNote(newPath);
            return;
        }

        log.info(
            `[NoteIndexingService] Carried embedding ${oldPath} -> ${newPath} without re-embedding`
        );

        // If the renamed file is the currently active one, refresh the sidebar.
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.path === newPath) {
            this.similarNoteCoordinator.emitNoteBottomViewModelFromPath(
                newPath
            );
        }
    }

    private async processUpdatedNote(path: string) {
        const note = await this.noteRepository.findByPath(
            path,
            !this.settingsService.get().includeFrontmatter
        );
        if (!note || !note.content) {
            return;
        }

        // Apply RegExp exclusion patterns before chunking
        const settings = this.settingsService.get();
        const patterns = settings.excludeRegexPatterns || [];

        // Create a copy of the note with filtered content
        const filteredNote = { ...note };

        // Apply each regex pattern to exclude matching content
        if (patterns.length > 0) {
            let filteredContent = note.content;
            for (const pattern of patterns) {
                try {
                    const regex = new RegExp(pattern, "gm");
                    filteredContent = filteredContent.replace(regex, "");
                } catch (e) {
                    log.warn(`Invalid RegExp pattern: ${pattern}`, e);
                }
            }
            filteredNote.content = filteredContent;
        }

        const splitted = await this.noteChunkingService.split(filteredNote);
        if (splitted.length === 0) {
            return;
        }

        log.info(`[NoteIndexingService] Generating embeddings for ${splitted.length} chunks (for indexing)`);

        // Prepare all texts for batch embedding
        const textsToEmbed = splitted.map((chunk) =>
            // Include title in first chunk to make it searchable
            chunk.chunkIndex === 0
                ? `${chunk.title}\n\n${chunk.content}`
                : chunk.content
        );

        // Single batch API call for all chunks. A failure here MUST propagate to
        // processChange's catch → handleChangeFailure (retry, then terminal
        // Errored). Do NOT swallow it: swallowing made a failed note take the
        // success path and get recorded as Indexed with zero chunks (#45/#46).
        const embeddings = await this.embeddingService.embedTexts(textsToEmbed);

        // Map embeddings back to chunks by index
        const noteChunks = splitted.map((chunk, index) =>
            chunk.withEmbedding(embeddings[index])
        );

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
            this.similarNoteCoordinator.emitNoteBottomViewModelFromPath(
                note.path
            );
        } else {
            log.info(`[NoteIndexingService] File is not currently active, skipping similar note search`);
        }
    }
}
