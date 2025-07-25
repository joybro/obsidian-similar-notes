import { NoteBottomView } from "@/components/NoteBottomView";
import log from "loglevel";
import type { App, MarkdownView } from "obsidian";
import type { Observable } from "rxjs";
import { BaseViewManager } from "./BaseViewManager";
import type { SimilarNoteCoordinator } from "./SimilarNoteCoordinator";
import type { ViewCreationConfig } from "./ViewManager";

/**
 * ViewManager specifically for NoteBottomView instances
 */
export class NoteBottomViewManager extends BaseViewManager<NoteBottomView> {
    constructor(
        app: App,
        private similarNoteCoordinator: SimilarNoteCoordinator,
        initialShowAtBottom: boolean,
        showAtBottomChanges$: Observable<boolean>
    ) {
        // Create a reference that can be updated
        let currentShowAtBottom = initialShowAtBottom;

        const config: ViewCreationConfig<NoteBottomView> = {
            shouldCreateView: (markdownView: MarkdownView) => {
                return currentShowAtBottom && !!markdownView.file;
            },

            createView: async (markdownView: MarkdownView) => {
                return this.createAndAttachNoteBottomView(markdownView);
            },

            onSettingsChange: () => {
                // This will be handled by our subscription below
            }
        };

        super(app, config);

        // Listen for showAtBottom changes
        showAtBottomChanges$.subscribe((newShowAtBottom) => {
            currentShowAtBottom = newShowAtBottom; // Update the closure variable
            this.handleShowAtBottomChange(newShowAtBottom);
        });
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
            this.recreateAllViews();
        } else {
            // Remove all bottom views
            this.removeAllViews();
        }
    }
}