import { NoteBottomView } from "@/components/NoteBottomView";
import type { App } from "obsidian";
import { MarkdownView, TFile } from "obsidian";
import type { SimilarNoteCoordinator } from "./SimilarNoteCoordinator";

export class LeafViewCoordinator {
    private noteBottomViewMap: Map<MarkdownView, NoteBottomView> = new Map();

    constructor(
        private app: App,
        private similarNoteCoordinator: SimilarNoteCoordinator
    ) {}

    async onFileOpen(file: TFile | null): Promise<void> {
        if (!file || !(file instanceof TFile)) {
            return;
        }

        const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeLeaf) {
            return;
        }

        if (this.noteBottomViewMap.has(activeLeaf)) return;

        const similarNotesView = await this.createAndAttachNoteBottomView(
            activeLeaf
        );
        if (!similarNotesView) {
            throw new Error("Failed to create similar notes view");
        }

        this.noteBottomViewMap.set(activeLeaf, similarNotesView);
    }

    async onLayoutChange(): Promise<void> {
        const activeLeaves = this.app.workspace.getLeavesOfType(
            MarkdownView.name
        ) as unknown as MarkdownView[];

        for (const leaf of this.noteBottomViewMap.keys()) {
            if (!activeLeaves.includes(leaf)) {
                this.noteBottomViewMap.get(leaf)?.unload();
                this.noteBottomViewMap.delete(leaf);
            }
        }
    }

    async onUnload(): Promise<void> {
        for (const similarNotesView of this.noteBottomViewMap.values()) {
            similarNotesView.unload();
        }
    }

    private async createAndAttachNoteBottomView(
        leaf: MarkdownView
    ): Promise<NoteBottomView | null> {
        // Find embedded backlinks container
        const embeddedBacklinksContainer = leaf.containerEl.querySelector(
            ".embedded-backlinks"
        );

        if (
            !embeddedBacklinksContainer ||
            !embeddedBacklinksContainer?.parentElement
        ) {
            return null;
        }

        const noteBottomView = new NoteBottomView(
            this.app.workspace,
            leaf,
            embeddedBacklinksContainer.parentElement,
            this.similarNoteCoordinator.getNoteBottomViewModelObservable()
        );

        // Move similar notes container before embedded backlinks container
        const noteBottomViewContainerEl = noteBottomView.getContainerEl();
        embeddedBacklinksContainer.parentElement.insertBefore(
            noteBottomViewContainerEl,
            embeddedBacklinksContainer
        );

        return noteBottomView;
    }
}
