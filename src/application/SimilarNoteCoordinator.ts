import type {
    NoteBottomViewModel,
    SimilarNoteEntry,
} from "@/components/NoteBottomViewReact";
import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { SimilarNoteFinder } from "@/domain/service/SimilarNoteFinder";
import type { TFile, Vault } from "obsidian";
import { BehaviorSubject } from "rxjs";

interface SimilarNoteCacheEntry {
    mtime: number;
    notes: SimilarNoteEntry[];
}

const MAX_CACHE_SIZE = 20;

export class SimilarNoteCoordinator {
    private noteBottomViewModel$ = new BehaviorSubject<NoteBottomViewModel>({
        currentFile: null,
        similarNoteEntries: [],
    });
    private cache = new Map<string, SimilarNoteCacheEntry>(); // file path -> entry

    constructor(
        private readonly vault: Vault,
        private readonly noteRepository: NoteRepository,
        private readonly similarNoteFinder: SimilarNoteFinder
    ) {}

    getNoteBottomViewModelObservable() {
        return this.noteBottomViewModel$.asObservable();
    }

    async onFileOpen(file: TFile | null) {
        if (!file) {
            return;
        }

        this.emitNoteBottomViewModel(file);
    }

    async emitNoteBottomViewModel(file: TFile) {
        const similarNotes = await this.getSimilarNotes(file);
        this.noteBottomViewModel$.next({
            currentFile: file,
            similarNoteEntries: similarNotes,
        });
    }

    async getSimilarNotes(file: TFile): Promise<SimilarNoteEntry[]> {
        const cacheEntry = this.cache.get(file.path);
        if (cacheEntry && cacheEntry.mtime === file.stat.mtime) {
            return cacheEntry.notes;
        }

        const note = await this.noteRepository.findByFile(file);
        const similarNotes = await this.similarNoteFinder.findSimilarNotes(
            note
        );

        const similarNoteEntries = similarNotes
            .map((similarNote) => ({
                file: this.vault.getFileByPath(similarNote.path),
                title: similarNote.title,
                similarity: similarNote.similarity,
            }))
            .filter(
                (viewModel) => viewModel.file !== null
            ) as SimilarNoteEntry[];

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
