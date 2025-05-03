import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { SimilarNoteFinder } from "@/domain/service/SimilarNoteFinder";
import type { TFile, Vault } from "obsidian";
import { BehaviorSubject } from "rxjs";

export interface SimilarNoteViewModel {
    file: TFile;
    title: string;
    similarity: number;
}

export class SimilarNoteCoordinator {
    private similarNotes$ = new BehaviorSubject<SimilarNoteViewModel[]>([]);

    constructor(
        private readonly vault: Vault,
        private readonly noteRepository: NoteRepository,
        private readonly similarNoteFinder: SimilarNoteFinder
    ) {}

    getSimilarNotesObservable() {
        return this.similarNotes$.asObservable();
    }

    async updateSimilarNotes(currentFile: TFile) {
        const note = await this.noteRepository.findByFile(currentFile);
        const similarNotes = await this.similarNoteFinder.findSimilarNotes(
            note
        );
        const viewModels = similarNotes
            .map((similarNote) => ({
                file: this.vault.getFileByPath(similarNote.path),
                title: similarNote.title,
                similarity: similarNote.similarity,
            }))
            .filter(
                (viewModel) => viewModel.file !== null
            ) as SimilarNoteViewModel[];
        this.similarNotes$.next(viewModels);
    }
}
