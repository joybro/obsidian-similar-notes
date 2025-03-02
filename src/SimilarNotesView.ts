import type { App, TFile } from "obsidian";
import { Component } from "obsidian";

// Interface for similar note items
interface SimilarNote {
    file: TFile;
    title: string;
    similarity: number;
}

export class SimilarNotesView extends Component {
    private containerEl: HTMLElement;
    private contentEl: HTMLElement;
    private currentFile: TFile | null;
    private collapsed = false;

    constructor(
        private app: App,
        private parentEl: HTMLElement,
        // Inject function to fetch similar notes (to be replaced with actual implementation later)
        private getSimilarNotes: (file: TFile) => Promise<SimilarNote[]>
    ) {
        super();
        this.containerEl = parentEl.createDiv({
            cls: "similar-notes-container",
        });
        this.createHeader();
        this.contentEl = this.containerEl.createDiv({
            cls: "similar-notes-content",
        });
    }

    private createHeader(): void {
        const headerEl = this.containerEl.createDiv({
            cls: "similar-notes-header nav-header",
        });

        // Add section title
        const titleEl = headerEl.createDiv({
            cls: "similar-notes-title tree-item-itself is-clickable",
        });
        const titleTextEl = titleEl.createDiv({
            cls: "similar-notes-title-text",
        });
        titleTextEl.setText("Similar notes");

        // Header click for collapse/expand functionality
        headerEl.addEventListener("click", () => {
            this.collapsed = !this.collapsed;
            this.contentEl.style.display = this.collapsed ? "none" : "block";

            // Toggle is-collapsed class
            if (this.collapsed) {
                titleEl.addClass("is-collapsed");
            } else {
                titleEl.removeClass("is-collapsed");
            }
        });
    }

    async updateForFile(file: TFile): Promise<void> {
        // Don't update if it's the same file
        if (this.currentFile && this.currentFile.path === file.path) return;

        this.currentFile = file;
        this.contentEl.empty();

        // Test with dummy data (to be replaced with actual similarity-based results later)
        const similarNotes = await this.getSimilarNotes(file);

        if (similarNotes.length === 0) {
            const emptyEl = this.contentEl.createDiv({
                cls: "similar-notes-empty",
            });
            emptyEl.setText("No similar notes found");
            return;
        }

        // Create similar notes list
        for (const note of similarNotes) {
            const itemEl = this.contentEl.createDiv({
                cls: "similar-notes-item tree-item-self is-clickable",
            });
            itemEl.setAttribute("draggable", "true");

            // Note title
            const titleEl = itemEl.createDiv({
                cls: "tree-item-inner",
            });
            titleEl.setText(note.title);

            // Similarity score
            const similarityEl = itemEl.createDiv({
                cls: "tree-item-flair-outer",
            });
            similarityEl.setText(`${note.similarity.toFixed(2)}`);

            // Open note on click
            itemEl.addEventListener("click", () => {
                this.app.workspace.getLeaf().openFile(note.file);
            });
        }
    }

    public getContainerEl(): HTMLElement {
        return this.containerEl;
    }
}
