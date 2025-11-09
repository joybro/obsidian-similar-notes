import type { SettingsService } from "@/application/SettingsService";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type { NoteChunkingService } from "@/domain/service/NoteChunkingService";
import type { NoteChangeQueue } from "@/services/noteChangeQueue";
import log from "loglevel";
import type { App } from "obsidian";
import { type Observable, BehaviorSubject } from "rxjs";
import type { SimilarNoteCoordinator } from "./SimilarNoteCoordinator";

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
        private app: App
    ) {}

    startLoop() {
        const fileChangeLoop = async () => {
            const count = this.noteChangeQueue.getFileChangeCount();
            this.noteChangeCount$.next(count);

            const changes = await this.noteChangeQueue.pollFileChanges(1);
            if (changes.length === 0) {
                this.fileChangeLoopTimer = setTimeout(fileChangeLoop, 1000);
                return;
            }

            const change = changes[0];
            log.info(`[NoteIndexingService] ===== Processing change: ${change.path} (${change.reason}) =====`);

            if (change.reason === "deleted") {
                await this.processDeletedNote(change.path);
            } else {
                await this.processUpdatedNote(change.path);
            }

            await this.noteChangeQueue.markNoteChangeProcessed(change);

            fileChangeLoop();
        };

        fileChangeLoop();
    }

    stopLoop() {
        if (this.fileChangeLoopTimer) {
            clearTimeout(this.fileChangeLoopTimer);
        }
    }

    getNoteChangeCount$(): Observable<number> {
        return this.noteChangeCount$.asObservable();
    }

    private async processDeletedNote(path: string) {
        await this.noteChunkRepository.removeByPath(path);
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
        let noteChunks;
        try {
            noteChunks = await Promise.all(
                splitted.map(async (chunk) =>
                    chunk.withEmbedding(
                        await this.embeddingService.embedText(chunk.content)
                    )
                )
            );
        } catch (error) {
            log.error("Failed to generate embeddings for note:", path, error);
            // Error notice is already shown by the provider, just skip this note
            return;
        }

        log.info(`[NoteIndexingService] Successfully generated embeddings, saving to repository`);

        const wasRemoved = await this.noteChunkRepository.removeByPath(
            note.path
        );
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
