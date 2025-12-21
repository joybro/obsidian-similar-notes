import log from "loglevel";
import type { App, Component, WorkspaceLeaf } from "obsidian";
import { MarkdownView } from "obsidian";
import type { ViewCreationConfig, ViewManager } from "./ViewManager";

/**
 * Base implementation of ViewManager that handles common view lifecycle management
 */
export class BaseViewManager<TView extends Component> implements ViewManager<TView> {
    private viewMap: Map<MarkdownView, TView> = new Map();

    constructor(
        protected app: App,
        private config: ViewCreationConfig<TView>
    ) {}

    async onActiveLeafChange(leaf: WorkspaceLeaf | null): Promise<void> {
        if (!leaf || !(leaf.view instanceof MarkdownView)) {
            return;
        }

        // Check if we should create a view for this leaf
        if (!this.config.shouldCreateView(leaf.view)) {
            return;
        }

        // Skip if view already exists
        if (this.viewMap.has(leaf.view)) {
            return;
        }

        try {
            const view = await this.config.createView(leaf.view);
            
            if (view) {
                this.viewMap.set(leaf.view, view);
                log.debug(`Created view for ${leaf.view.file?.path || 'unknown file'}`);
            }
        } catch (error) {
            log.error("Failed to create view:", error);
        }
    }

    async onLayoutChange(): Promise<void> {
        const activeLeaves = this.app.workspace.getLeavesOfType("markdown");

        // Clean up views for deleted leaves
        for (const [markdownView, view] of this.viewMap) {
            if (!activeLeaves.includes(markdownView.leaf)) {
                try {
                    view.unload();
                    this.viewMap.delete(markdownView);
                    log.debug(`Cleaned up view for ${markdownView.file?.path || 'unknown file'}`);
                } catch (error) {
                    log.error("Error unloading view:", error);
                }
            }
        }
    }

    async onUnload(): Promise<void> {
        for (const [markdownView, view] of this.viewMap) {
            try {
                view.unload();
                log.debug(`Unloaded view for ${markdownView.file?.path || 'unknown file'}`);
            } catch (error) {
                log.error("Error unloading view during cleanup:", error);
            }
        }
        this.viewMap.clear();
    }

    getManagedViews(): Map<MarkdownView, TView> {
        return new Map(this.viewMap);
    }

    hasView(markdownView: MarkdownView): boolean {
        return this.viewMap.has(markdownView);
    }

    getView(markdownView: MarkdownView): TView | undefined {
        return this.viewMap.get(markdownView);
    }

    /**
     * Handle settings changes that might affect view creation
     */
    handleSettingsChange(changes: Record<string, unknown>): void {
        if (this.config.onSettingsChange) {
            this.config.onSettingsChange(changes);
        }
    }

    /**
     * Recreate all views (useful when settings change)
     */
    async recreateAllViews(): Promise<void> {
        const activeLeaves = this.app.workspace.getLeavesOfType("markdown");
        
        // Remove all existing views
        for (const [, view] of this.viewMap) {
            try {
                view.unload();
            } catch (error) {
                log.error("Error unloading view during recreation:", error);
            }
        }
        this.viewMap.clear();

        // Recreate views for all active leaves
        for (const leaf of activeLeaves) {
            if (leaf.view instanceof MarkdownView) {
                await this.onActiveLeafChange(leaf);
            }
        }
    }

    /**
     * Remove all views without unloading (useful when feature is disabled)
     */
    removeAllViews(): void {
        for (const [, view] of this.viewMap) {
            try {
                view.unload();
            } catch (error) {
                log.error("Error unloading view:", error);
            }
        }
        this.viewMap.clear();
    }
}