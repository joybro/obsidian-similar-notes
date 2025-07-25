import { NoteBottomView } from "@/components/NoteBottomView";
import type { App, WorkspaceLeaf } from "obsidian";
import { MarkdownView } from "obsidian";
import type { SettingsService } from "./SettingsService";
import type { SimilarNoteCoordinator } from "./SimilarNoteCoordinator";

export class LeafViewCoordinator {
    private noteBottomViewMap: Map<MarkdownView, NoteBottomView> = new Map();

    constructor(
        private app: App,
        private similarNoteCoordinator: SimilarNoteCoordinator,
        private settingsService: SettingsService
    ) {
        // Listen for showAtBottom setting changes
        this.settingsService.getNewSettingsObservable().subscribe((changes) => {
            if (changes.showAtBottom !== undefined) {
                this.handleShowAtBottomChange(changes.showAtBottom);
            }
        });
    }

    async onActiveLeafChange(leaf: WorkspaceLeaf | null): Promise<void> {
        if (!leaf || !(leaf.view instanceof MarkdownView)) {
            return;
        }

        // Only create view if showAtBottom is enabled
        if (!this.settingsService.get().showAtBottom) {
            return;
        }

        if (this.noteBottomViewMap.has(leaf.view)) return;

        const similarNotesView = await this.createAndAttachNoteBottomView(
            leaf.view
        );
        if (!similarNotesView) {
            throw new Error("Failed to create similar notes view");
        }

        this.noteBottomViewMap.set(leaf.view, similarNotesView);
    }

    async onLayoutChange(): Promise<void> {
        const activeLeaves = this.app.workspace.getLeavesOfType("markdown");

        // Deleted views
        for (const view of this.noteBottomViewMap.keys()) {
            if (!activeLeaves.includes(view.leaf)) {
                this.noteBottomViewMap.get(view)?.unload();
                this.noteBottomViewMap.delete(view);
            }
        }
    }

    async onUnload(): Promise<void> {
        for (const similarNotesView of this.noteBottomViewMap.values()) {
            similarNotesView.unload();
        }
    }

    private async createAndAttachNoteBottomView(
        view: MarkdownView
    ): Promise<NoteBottomView | null> {
        // Find embedded backlinks container
        const embeddedBacklinksContainer = view.containerEl.querySelector(
            ".embedded-backlinks"
        );

        if (
            !embeddedBacklinksContainer ||
            !embeddedBacklinksContainer?.parentElement
        ) {
            return null;
        }

        if (!view.file) {
            return null;
        }

        const noteBottomView = new NoteBottomView(
            this.app.workspace,
            this.app.vault.getName(),
            view,
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

    private handleShowAtBottomChange(showAtBottom: boolean): void {
        if (showAtBottom) {
            // Re-create views for all open markdown leaves
            const activeLeaves = this.app.workspace.getLeavesOfType("markdown");
            activeLeaves.forEach((leaf) => {
                if (leaf.view instanceof MarkdownView) {
                    this.onActiveLeafChange(leaf);
                }
            });
        } else {
            // Remove all bottom views
            for (const [view, bottomView] of this.noteBottomViewMap) {
                bottomView.unload();
            }
            this.noteBottomViewMap.clear();
        }
    }
}
