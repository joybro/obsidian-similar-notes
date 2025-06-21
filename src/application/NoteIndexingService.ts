import type { SettingsService } from "@/application/SettingsService";
import type { NoteChunkRepository } from "@/domain/repository/NoteChunkRepository";
import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { EmbeddingService } from "@/domain/service/EmbeddingService";
import type { NoteChunkingService } from "@/domain/service/NoteChunkingService";
import type { NoteChangeQueue } from "@/services/noteChangeQueue";
import log from "loglevel";
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
        private settingsService: SettingsService
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
            log.info("processing change", change.path);

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

        const splitted = await this.noteChunkingService.split(note);
        if (splitted.length === 0) {
            return;
        }

        const noteChunks = await Promise.all(
            splitted.map(async (chunk) =>
                chunk.withEmbedding(
                    await this.embeddingService.embedText(chunk.content)
                )
            )
        );

        log.info("chunks", noteChunks);

        const wasRemoved = await this.noteChunkRepository.removeByPath(note.path);
        await this.noteChunkRepository.putMulti(noteChunks);
        
        log.info(
            "count of chunks in embedding store",
            await this.noteChunkRepository.count()
        );

        // TODO: this should be refactored with an event driven approach
        this.similarNoteCoordinator.emitNoteBottomViewModelFromPath(note.path);
    }
}
