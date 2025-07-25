import { NoteBottomView } from "@/components/NoteBottomView";
import log from "loglevel";
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

        try {
            const similarNotesView = await this.createAndAttachNoteBottomView(
                leaf.view
            );

            if (similarNotesView) {
                this.noteBottomViewMap.set(leaf.view, similarNotesView);
            }
            // If view creation returns null, it's a valid case (e.g., no backlinks container)
            // so we don't throw an error
        } catch (error) {
            log.error("Failed to create similar notes view:", error);
            // Don't throw - allow the plugin to continue functioning
        }
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
        try {
            // Validate prerequisites
            if (!view.file) {
                // No file open in this view - this is normal
                return null;
            }

            // Find embedded backlinks container
            const embeddedBacklinksContainer = view.containerEl.querySelector(
                ".embedded-backlinks"
            );

            if (
                !embeddedBacklinksContainer ||
                !embeddedBacklinksContainer?.parentElement
            ) {
                // Some views might not have backlinks container - this is expected
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
        } catch (error) {
            log.error("Error creating NoteBottomView:", error);
            // Return null instead of throwing to allow graceful degradation
            return null;
        }
    }

    private handleShowAtBottomChange(showAtBottom: boolean): void {
        if (showAtBottom) {
            // Re-create views for all open markdown leaves
            const activeLeaves = this.app.workspace.getLeavesOfType("markdown");
            activeLeaves.forEach(async (leaf) => {
                if (leaf.view instanceof MarkdownView) {
                    await this.onActiveLeafChange(leaf);
                }
            });
        } else {
            // Remove all bottom views
            for (const [, bottomView] of this.noteBottomViewMap) {
                try {
                    bottomView.unload();
                } catch (error) {
                    log.error("Error unloading bottom view:", error);
                }
            }
            this.noteBottomViewMap.clear();
        }
    }
}
