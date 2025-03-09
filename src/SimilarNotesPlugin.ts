import type { EventRef, WorkspaceLeaf } from "obsidian";
import { MarkdownView, Plugin, TFile } from "obsidian";
import { SimilarNotesView } from "./SimilarNotesView";
import { SimilarNotesSettingTab } from "./components/SimilarNotesSettingTab";

export default class SimilarNotesPlugin extends Plugin {
    private similarNotesViews: Map<WorkspaceLeaf, SimilarNotesView> = new Map();
    private eventRefs: EventRef[] = []; // Use EventRef type instead of any

    async onload() {
        console.log("Loading Similar Notes plugin");

        // Add settings tab
        this.addSettingTab(new SimilarNotesSettingTab(this.app, this));

        // Register event when active leaf changes
        const leafChangeRef = this.app.workspace.on(
            "active-leaf-change",
            async (leaf) => {
                if (leaf && leaf.view instanceof MarkdownView) {
                    await this.updateSimilarNotesView(leaf);
                }
            }
        );
        this.eventRefs.push(leafChangeRef);
        this.registerEvent(leafChangeRef);

        // Register event when current open file changes
        const fileOpenRef = this.app.workspace.on("file-open", async (file) => {
            if (file && file instanceof TFile) {
                const activeLeaf = this.app.workspace.activeLeaf;
                if (activeLeaf && activeLeaf.view instanceof MarkdownView) {
                    await this.updateSimilarNotesView(activeLeaf);
                }
            }
        });
        this.eventRefs.push(fileOpenRef);
        this.registerEvent(fileOpenRef);
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
        // Find embedded backlinks container
        const embeddedBacklinksContainer = leaf.view.containerEl.querySelector(
            ".embedded-backlinks"
        );

        if (embeddedBacklinksContainer?.parentElement) {
            // Insert similar notes section before embedded backlinks container
            const similarNotesView = new SimilarNotesView(
                this.app,
                embeddedBacklinksContainer.parentElement,
                (file) => this.getSimilarNotes(file)
            );

            this.similarNotesViews.set(leaf, similarNotesView);
            await similarNotesView.updateForFile(file);

            // Move similar notes container before embedded backlinks container
            const similarNotesContainer = similarNotesView.getContainerEl();
            embeddedBacklinksContainer.parentElement.insertBefore(
                similarNotesContainer,
                embeddedBacklinksContainer
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

        const similarNotes = await Promise.all(
            randomFiles.map(async (f) => {
                return {
                    file: f,
                    title: f.basename,
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

    // Handle reindexing of notes
    async reindexNotes(): Promise<void> {
        // TODO: Implement actual reindexing logic
        console.log("Reindexing notes...");

        // Refresh all views after reindexing
        for (const [leaf, view] of this.similarNotesViews.entries()) {
            if (leaf.view instanceof MarkdownView && leaf.view.file) {
                await view.updateForFile(leaf.view.file);
            }
        }
    }

    onunload() {
        console.log("Unloading Similar Notes plugin");

        // Manually unregister events (though this is redundant with this.registerEvent)
        for (const eventRef of this.eventRefs) {
            this.app.workspace.offref(eventRef);
        }

        // Clean up all created views
        for (const view of this.similarNotesViews.values()) {
            const containerEl = view.getContainerEl();
            if (containerEl?.parentNode) {
                containerEl.parentNode.removeChild(containerEl);
            }
            view.unload();
        }
        this.similarNotesViews.clear();
    }
}
