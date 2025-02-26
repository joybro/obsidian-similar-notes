import type { WorkspaceLeaf } from "obsidian";
import { MarkdownView, Plugin, TFile } from "obsidian";
import { SimilarNotesView } from "./SimilarNotesView";

export default class SimilarNotesPlugin extends Plugin {
    private similarNotesViews: Map<WorkspaceLeaf, SimilarNotesView> = new Map();

    async onload() {
        console.log("Loading Similar Notes plugin");

        // Register event when active leaf changes
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", async (leaf) => {
                if (leaf && leaf.view instanceof MarkdownView) {
                    await this.updateSimilarNotesView(leaf);
                }
            })
        );

        // Register event when current open file changes
        this.registerEvent(
            this.app.workspace.on("file-open", async (file) => {
                if (file && file instanceof TFile) {
                    const activeLeaf = this.app.workspace.activeLeaf;
                    if (activeLeaf && activeLeaf.view instanceof MarkdownView) {
                        await this.updateSimilarNotesView(activeLeaf);
                    }
                }
            })
        );
    }

    // Update Similar Notes view for the active leaf
    private async updateSimilarNotesView(leaf: WorkspaceLeaf): Promise<void> {
        if (!(leaf.view instanceof MarkdownView)) return;

        const file = leaf.view.file;
        if (!file) return;

        // If view already exists for this leaf, update it
        if (this.similarNotesViews.has(leaf)) {
            await this.similarNotesViews.get(leaf)?.updateForFile(file);
            return;
        }

        // Create new view
        // Find backlinks container (depends on Obsidian's internal structure)
        const backlinksContainer =
            leaf.view.containerEl.querySelector(".backlink-pane");

        if (backlinksContainer?.parentElement) {
            // Insert similar notes section before backlinks container
            const similarNotesView = new SimilarNotesView(
                this.app,
                backlinksContainer.parentElement,
                (file) => this.getSimilarNotes(file)
            );

            this.similarNotesViews.set(leaf, similarNotesView);
            await similarNotesView.updateForFile(file);

            // Move similar notes container before backlinks container
            const similarNotesContainer = similarNotesView.getContainerEl();
            backlinksContainer.parentElement.insertBefore(
                similarNotesContainer,
                backlinksContainer
            );
        }
    }

    // Get similar notes (dummy data)
    private async getSimilarNotes(file: TFile) {
        // Currently returns dummy data
        // Will be replaced with actual embedding and similarity search later
        const allFiles = this.app.vault
            .getMarkdownFiles()
            .filter((f) => f.path !== file.path);

        // Randomly select up to 5 files
        const randomFiles = allFiles
            .sort(() => 0.5 - Math.random())
            .slice(0, Math.min(5, allFiles.length));

        // Work to get preview text
        const similarNotes = await Promise.all(
            randomFiles.map(async (f) => {
                let preview = "";
                try {
                    const content = await this.app.vault.read(f);
                    // Use first 100 characters as preview
                    preview =
                        content.slice(0, 100).replace(/\n/g, " ") +
                        (content.length > 100 ? "..." : "");
                } catch (e) {
                    preview = "Preview not available";
                }

                return {
                    file: f,
                    title: f.basename,
                    preview: preview,
                    // Dummy similarity score (between 0.6 and 0.95)
                    similarity: 0.6 + Math.random() * 0.35,
                };
            })
        );

        // Sort by similarity score in descending order
        return similarNotes.sort(
            (a, b) => (b.similarity || 0) - (a.similarity || 0)
        );
    }

    onunload() {
        console.log("Unloading Similar Notes plugin");

        // Clean up all created views
        for (const view of this.similarNotesViews.values()) {
            view.getContainerEl().remove();
            view.unload();
        }
        this.similarNotesViews.clear();
    }
}
