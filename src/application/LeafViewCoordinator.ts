import { SimilarNotesView } from "@/components/SimilarNotesView";
import type { App, WorkspaceLeaf } from "obsidian";
import { MarkdownView, TFile } from "obsidian";
import type { SimilarNoteCoordinator } from "./SimilarNoteCoordinator";

export class LeafViewCoordinator {
    private noteBottomViewMap: Map<WorkspaceLeaf, SimilarNotesView> = new Map();

    constructor(
        private app: App,
        private similarNoteCoordinator: SimilarNoteCoordinator
    ) {}

    async onFileOpen(file: TFile | null): Promise<void> {
        if (!file || !(file instanceof TFile)) {
            return;
        }

        const activeLeaf = this.app.workspace.activeLeaf;
        if (!activeLeaf || !(activeLeaf.view instanceof MarkdownView)) {
            return;
        }

        if (this.noteBottomViewMap.has(activeLeaf)) return;

        const similarNotesView = this.createAndAttachNoteBottomView(activeLeaf);
        if (!similarNotesView) {
            throw new Error("Failed to create similar notes view");
        }

        this.noteBottomViewMap.set(activeLeaf, similarNotesView);
    }

    async onLayoutChange(): Promise<void> {
        const activeLeaves = this.app.workspace.getLeavesOfType("markdown");

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

    private createAndAttachNoteBottomView(
        leaf: WorkspaceLeaf
    ): SimilarNotesView | null {
        // Find embedded backlinks container
        const embeddedBacklinksContainer = leaf.view.containerEl.querySelector(
            ".embedded-backlinks"
        );

        if (
            !embeddedBacklinksContainer ||
            !embeddedBacklinksContainer?.parentElement
        ) {
            return null;
        }

        const similarNotesView = new SimilarNotesView(
            this.app,
            leaf,
            embeddedBacklinksContainer.parentElement,
            this.similarNoteCoordinator.getNoteBottomViewModelObservable()
        );

        // Move similar notes container before embedded backlinks container
        const similarNotesContainer = similarNotesView.getContainerEl();
        embeddedBacklinksContainer.parentElement.insertBefore(
            similarNotesContainer,
            embeddedBacklinksContainer
        );

        return similarNotesView;
    }
}
