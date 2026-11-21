import { VIEW_TYPE_SIMILAR_NOTES_SIDEBAR } from "@/constants/viewTypes";
import { createActiveFileMockView } from "@/utils/viewUtils";
import type { WorkspaceLeaf } from "obsidian";
import { ItemView } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import type { Observable } from "rxjs";
import NoteBottomViewReact, {
    type NoteBottomViewModel,
} from "./NoteBottomViewReact";

export class SimilarNotesSidebarView extends ItemView {
    private root: Root | null = null;
    private bottomViewModelSubject$: Observable<NoteBottomViewModel>;
    private openSemanticSearch: (onDismissed: () => void) => void;

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

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("similar-notes-sidebar-container");

        // Create a mock leaf that represents the current active file
        const mockLeaf = createActiveFileMockView(this.app);

        // Create React root and render component
        this.root = createRoot(container);
        this.root.render(
            <NoteBottomViewReact
                workspace={this.app.workspace}
                vaultName={this.app.vault.getName()}
                leaf={mockLeaf}
                bottomViewModelSubject$={this.bottomViewModelSubject$}
                viewType="sidebar"
                onOpenSemanticSearch={this.openSemanticSearch}
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
