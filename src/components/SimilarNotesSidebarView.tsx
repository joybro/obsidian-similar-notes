import { VIEW_TYPE_SIMILAR_NOTES_SIDEBAR } from "@/constants/viewTypes";
import { createActiveFileMockView } from "@/utils/viewUtils";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import { ItemView } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import type { Observable } from "rxjs";
import NoteBottomViewReact, {
    type NoteBottomViewModel,
} from "./NoteBottomViewReact";
import { readExpandAll, withExpandAll } from "./sidebarViewState";

export class SimilarNotesSidebarView extends ItemView {
    private root: Root | null = null;
    private bottomViewModelSubject$: Observable<NoteBottomViewModel>;
    private openSemanticSearch: (onDismissed: () => void) => void;
    /** Expand-all mode, kept in this view's workspace state (survives restarts). */
    private expandAll = false;
    private mockLeaf: ReturnType<typeof createActiveFileMockView> | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        bottomViewModelSubject$: Observable<NoteBottomViewModel>,
        openSemanticSearch: (onDismissed: () => void) => void
    ) {
        super(leaf);
        this.bottomViewModelSubject$ = bottomViewModelSubject$;
        this.openSemanticSearch = openSemanticSearch;
    }

    getViewType(): string {
        return VIEW_TYPE_SIMILAR_NOTES_SIDEBAR;
    }

    getDisplayText(): string {
        return "Similar Notes";
    }

    getIcon(): string {
        return "telescope";
    }

    getState(): Record<string, unknown> {
        return withExpandAll(super.getState(), this.expandAll);
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        const expandAll = readExpandAll(state);
        if (expandAll !== undefined && expandAll !== this.expandAll) {
            this.expandAll = expandAll;
            this.renderView();
        }
        await super.setState(state, result);
    }

    /** User pressed Expand all / Collapse all: re-render and save the layout. */
    private setExpandAll = (expandAll: boolean) => {
        if (expandAll === this.expandAll) return;
        this.expandAll = expandAll;
        this.renderView();
        this.app.workspace.requestSaveLayout();
    };

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("similar-notes-sidebar-container");

        // Create a mock leaf that represents the current active file
        const mockLeaf = createActiveFileMockView(this.app);

        // Create React root and render component
        this.root = createRoot(container);
        this.mockLeaf = mockLeaf;
        this.renderView();
    }

    private renderView() {
        if (!this.root || !this.mockLeaf) return;
        this.root.render(
            <NoteBottomViewReact
                workspace={this.app.workspace}
                vaultName={this.app.vault.getName()}
                leaf={this.mockLeaf}
                bottomViewModelSubject$={this.bottomViewModelSubject$}
                viewType="sidebar"
                onOpenSemanticSearch={this.openSemanticSearch}
                savedExpandMode={{
                    expandAll: this.expandAll,
                    onExpandAllChange: this.setExpandAll,
                }}
            />
        );
    }

    async onClose() {
        if (this.root) {
            this.root.unmount();
            this.root = null;
        }
    }
}
