import type { WorkspaceLeaf } from "obsidian";
import { ItemView, MarkdownView } from "obsidian";
import { createRoot, Root } from "react-dom/client";
import type { Observable } from "rxjs";
import NoteBottomViewReact, {
    type NoteBottomViewModel,
} from "./NoteBottomViewReact";

export const VIEW_TYPE_SIMILAR_NOTES_SIDEBAR = "similar-notes-sidebar";

export class SimilarNotesSidebarView extends ItemView {
    private root: Root | null = null;
    private bottomViewModelSubject$: Observable<NoteBottomViewModel>;

    constructor(
        leaf: WorkspaceLeaf,
        bottomViewModelSubject$: Observable<NoteBottomViewModel>
    ) {
        super(leaf);
        this.bottomViewModelSubject$ = bottomViewModelSubject$;
    }

    getViewType(): string {
        return VIEW_TYPE_SIMILAR_NOTES_SIDEBAR;
    }

    getDisplayText(): string {
        return "Similar Notes";
    }

    getIcon(): string {
        return "files";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("similar-notes-sidebar-container");

        // Create a mock leaf that represents the current active file
        const mockLeaf = {
            get file() {
                const activeView =
                    this.app.workspace.getActiveViewOfType(MarkdownView);
                return activeView?.file || null;
            },
            app: this.app,
        } as MarkdownView;

        // Create React root and render component
        this.root = createRoot(container);
        this.root.render(
            <NoteBottomViewReact
                workspace={this.app.workspace}
                vaultName={this.app.vault.getName()}
                leaf={mockLeaf}
                bottomViewModelSubject$={this.bottomViewModelSubject$}
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
