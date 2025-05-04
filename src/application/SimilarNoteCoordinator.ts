import type {
    NoteBottomViewModel,
    SimilarNoteEntry,
} from "@/components/SimilarNotesViewReact";
import type { NoteRepository } from "@/domain/repository/NoteRepository";
import type { SimilarNoteFinder } from "@/domain/service/SimilarNoteFinder";
import type { TFile, Vault } from "obsidian";
import { Subject } from "rxjs";

export class SimilarNoteCoordinator {
    private noteBottomViewModel$ = new Subject<NoteBottomViewModel>();

    constructor(
        private readonly vault: Vault,
        private readonly noteRepository: NoteRepository,
        private readonly similarNoteFinder: SimilarNoteFinder
    ) {}

    getNoteBottomViewModelObservable() {
        return this.noteBottomViewModel$.asObservable();
    }

    async updateSimilarNotes(currentFile: TFile) {
        const note = await this.noteRepository.findByFile(currentFile);
        const similarNotes = await this.similarNoteFinder.findSimilarNotes(
            note
        );
        const entries = similarNotes
            .map((similarNote) => ({
                file: this.vault.getFileByPath(similarNote.path),
                title: similarNote.title,
                similarity: similarNote.similarity,
            }))
            .filter(
                (viewModel) => viewModel.file !== null
            ) as SimilarNoteEntry[];
        const viewModel = {
            currentFile: currentFile,
            similarNoteEntries: entries,
        };
        this.noteBottomViewModel$.next(viewModel);
    }
}
