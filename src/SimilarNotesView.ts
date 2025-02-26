import type { App, TFile } from "obsidian";
import { Component } from "obsidian";

// Interface for similar note items
interface SimilarNote {
    file: TFile;
    title: string;
    preview: string;
    similarity?: number; // Optional similarity score
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
            cls: "similar-notes-title nav-folder-title",
        });
        const titleTextEl = titleEl.createDiv({
            cls: "similar-notes-title-text nav-folder-title-content",
        });
        titleTextEl.setText("Similar notes");

        // Add toggle icon
        const collapseIconEl = titleTextEl.createDiv({
            cls: "similar-notes-collapse-icon collapse-icon",
        });
        collapseIconEl.innerHTML = this.collapsed ? "▶" : "▼";

        // Header click for collapse/expand functionality
        headerEl.addEventListener("click", () => {
            this.collapsed = !this.collapsed;
            collapseIconEl.innerHTML = this.collapsed ? "▶" : "▼";
            this.contentEl.style.display = this.collapsed ? "none" : "block";
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
        const listEl = this.contentEl.createEl("ul", {
            cls: "similar-notes-list",
        });

        for (const note of similarNotes) {
            const itemEl = listEl.createEl("li", { cls: "similar-notes-item" });

            // Note title
            const titleEl = itemEl.createEl("div", {
                cls: "similar-notes-item-title",
            });
            titleEl.setText(note.title);

            // Note preview
            const previewEl = itemEl.createEl("div", {
                cls: "similar-notes-item-preview",
            });
            previewEl.setText(note.preview);

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
